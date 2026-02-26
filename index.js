#!/usr/bin/env node
'use strict';

var fs = require('fs');
var fsp = fs.promises;
var path = require('path');
var os = require('os');
var url = require('url');
var child = require('child_process');
var chalk = require('chalk');
var glob = require('glob');
var minimist = require('minimist');
var fetch = require('node-fetch');
var cheerio = require('cheerio');
var beautify = require('js-beautify').html;

/* single, deterministic cache path in os temp */
var CACHE_DIR = path.join(os.tmpdir(), 'w3c-validate-html');
var CACHED_JAR = path.join(CACHE_DIR, 'vnu.jar');
var CURRENT_JAR_PATH = null;

var JAR_URLS = [
    'https://github.com/validator/validator/releases/latest/download/vnu.jar'
];

var urlToFileMap = {};

/**
 * Main validate entry point
 * Validate a URL, file/folder, or raw HTML string using vnu.jar
 * @param {string} input - URL, file/folder path, or HTML string
 * @param {object} [cfg] - Optional config
 * @returns {Promise<object>} - Validation result(s)
 */
async function validate(input, cfg) {

    cfg = cfg || {};

    if (typeof input !== 'string' || !input.trim()) {
        throw new Error('Input must be a non-empty string (URL, file, or HTML)');
    }

    if (isUrl(input)) {
        return validateUrl(input, cfg);
    }

    if (isFilePath(input)) {
        return validateFiles(input, cfg);
    }

    if (isHtml(input)) {
        return validateHtmlString(input, cfg);
    }
}

/**
 * Checks if Java is installed and available in PATH.
 * @returns {Promise<boolean>} Resolves true if Java is available.
 */
async function hasJava() {
    return new Promise(resolve => {
        const p = child.spawn('java', ['-version']);
        let sawOutput = false;
        p.on('error', () => resolve(false));
        p.stderr.on('data', () => { sawOutput = true; });
        p.on('close', code => resolve(code === 0 || sawOutput));
    });
}

/**
 * Ensures a directory exists (creates if missing).
 * @param {string} dir Directory path
 */
function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

/**
 * Checks if a file is a valid JAR (zip header).
 * @param {string} file Path to jar file
 * @returns {Promise<boolean>} True if file is a JAR
 */
async function isJar(file) {
    try {
        const fd = await fsp.open(file, 'r');
        const buf = Buffer.alloc(2);
        await fd.read(buf, 0, 2, 0);
        await fd.close();
        return buf[0] === 0x50 && buf[1] === 0x4B; // 'PK' zip header
    } catch (e) {
        return false;
    }
}

/**
 * Downloads a file from a URL to disk.
 * @param {string} href URL to download
 * @param {string} dest Destination file path
 */
async function download(href, dest) {
    const res = await fetch(href, { headers: { 'User-Agent': 'curl/8 (+node)' }, redirect: 'follow' });
    if (!res.ok) throw new Error('download failed ' + res.status);
    const tmp = dest + '.part';
    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        res.body.pipe(out);
        res.body.on('error', reject);
        out.on('finish', resolve);
    });
    try {
        fs.renameSync(tmp, dest);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            // Download failed, .part file does not exist
            console.error(chalk.red('      Failed to download: ') + href + chalk.dim(' (no file written)'));
        } else {
            throw err;
        }
    }
}

/**
 * Ensures vnu.jar is available, downloads if missing.
 * @returns {Promise<string>} Path to usable jar
 */
async function resolveJarPath() {
    if (fs.existsSync(CACHED_JAR) && await isJar(CACHED_JAR)) return CACHED_JAR;
    ensureDir(CACHE_DIR);
    try { fs.unlinkSync(CACHED_JAR); } catch (e) { }
    for (const url of JAR_URLS) {
        try {
            await download(url, CACHED_JAR);
            if (await isJar(CACHED_JAR)) return CACHED_JAR;
        } catch (e2) { try { fs.unlinkSync(CACHED_JAR); } catch (e3) { } }
    }
    throw new Error('failed to obtain vnu.jar');
}

/**
 * Parse comma or space separated list into array
 * @param {string|Array|undefined} v - Raw input
 * @returns {Array<string>} - Normalized list
 */
function toList(v) {
    if (!v) { return []; }
    if (Array.isArray(v)) { return v; }
    return String(v).split(/[,\s]+/).filter(Boolean);
}

/**
 * Create a safe filename from a url
 * @param {string} href - Url to encode
 * @returns {string} - Safe file name
 */
function toSafeName(href) {
    var s = String(href || '');
    var out = '';
    var i;
    var ch;

    s = s.replace(/^https?:\/\//i, '');
    s = s.replace(/\/+/g, '/');

    /* convert url chars to filename safe chars without stripping query */
    for (i = 0; i < s.length; i++) {
        ch = s.charAt(i);

        /* keep common safe chars */
        if (/[a-z0-9]/i.test(ch) || ch === '/' || ch === '.' || ch === '_' || ch === '-') {
            out += ch;
        }
        /* map separators to readable tokens */
        else if (ch === '?') {
            out += '__q__';
        }
        else if (ch === '&') {
            out += '__and__';
        }
        else if (ch === '=') {
            out += '__eq__';
        }
        else if (ch === '#') {
            out += '__hash__';
        }
        /* everything else becomes underscore */
        else {
            out += '_';
        }
    }

    out = out.replace(/\/+/g, '/');
    out = out.replace(/_+/g, '_');
    out = out.replace(/\//g, '_');
    out = out.replace(/^_+|_+$/g, '');

    if (!out) { out = 'index.html'; }
    if (!/\.html?$/i.test(out)) { out += '.html'; }

    return out;
}

/**
 * Extract first json array or object from text
 * @param {string} text - Raw process output
 * @returns {any|null} - Parsed json or null
 */
function safeParseFirstJson(text) {
    var s = String(text || '');

    var a0 = s.indexOf('[');
    var a1 = s.lastIndexOf(']');
    if (a0 !== -1 && a1 !== -1 && a1 > a0) {
        try { return JSON.parse(s.slice(a0, a1 + 1)); }
        catch (e) { /* ignore */ }
    }

    var o0 = s.indexOf('{');
    var o1 = s.lastIndexOf('}');
    if (o0 !== -1 && o1 !== -1 && o1 > o0) {
        try { return JSON.parse(s.slice(o0, o1 + 1)); }
        catch (e2) { /* ignore */ }
    }

    return null;
}

/**
 * Run vnu against a local html file
 * @param {string} file - Html file path
 * @param {object} cfg - Config
 * @returns {Promise<{stdout:string,stderr:string,code:number}>} - Resolves process output
 */
async function runOne(file, cfg) {
    return new Promise(function (resolve) {
        var env = {};
        var k;

        for (k in process.env) {
            if (Object.prototype.hasOwnProperty.call(process.env, k)) {
                env[k] = process.env[k];
            }
        }

        env.http_proxy = '';
        env.https_proxy = '';
        env.no_proxy = '';

        var args = [
            '-Djava.net.useSystemProxies=false',
            '-Dhttp.proxyHost=', '-Dhttp.proxyPort=',
            '-Dhttps.proxyHost=', '-Dhttps.proxyPort=',
            '-jar', CURRENT_JAR_PATH,
            '--format', 'json',
            '--asciiquotes',
            '--no-langdetect',
            file
        ];

        if (cfg && cfg.html) {
            args.push('--html');
        }

        var p = child.spawn('java', args, { env: env });

        var out = '';
        var err = '';

        p.stdout.on('data', function (d) { out += String(d || ''); });
        p.stderr.on('data', function (d) { err += String(d || ''); });

        p.on('close', function (code) { resolve({ stdout: out, stderr: err, code: code || 0 }); });
        p.on('error', function () { resolve({ stdout: out, stderr: err, code: 1 }); });
    });
}

/**
 * Clean validator message
 * @param {string} s - Raw message
 * @returns {string} - Clean message
 */
function cleanMessage(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse vnu json messages into errors and warnings
 * @param {any} json - Parsed json
 * @param {object} cfg - Config
 * @returns {{errors:Array,warnings:Array}} - Parsed issues
 */
function parseIssuesFromJson(json, cfg) {
    var errors = [];
    var warnings = [];

    var list = json;

    if (!Array.isArray(list) && json && Array.isArray(json.messages)) {
        list = json.messages;
    }

    if (!Array.isArray(list)) {
        return { errors: errors, warnings: warnings };
    }

    for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var type = String(it.type || '').toLowerCase();
        var subType = String(it.subType || '').toLowerCase();

        var line = parseInt(it.lastLine || it.firstLine || it.line, 10) || 0;
        var col = parseInt(it.lastColumn || it.firstColumn || it.column, 10) || 0;

        var msg = cleanMessage(it.message || it.msg || '');

        if (!msg) {
            continue;
        }

        if (type === 'error') {
            errors.push({ line: line, col: col, msg: msg });
            continue;
        }

        if (cfg && cfg.warnings > 0) {
            if (type === 'info' || type === 'warning') {
                if (subType === 'warning' || type === 'warning') {
                    warnings.push({ line: line, col: col, msg: msg });
                }
            }
        }
    }

    return { errors: errors, warnings: warnings };
}

/**
 * Parse validator output
 * @param {{stdout:string,stderr:string,code:number}} proc - Process output
 * @param {object} cfg - Config
 * @returns {{errors:Array,warnings:Array}} - Parsed issues
 */
function parseIssues(proc, cfg) {
    var json =
        safeParseFirstJson(proc.stdout) ||
        safeParseFirstJson(proc.stderr) ||
        safeParseFirstJson(String(proc.stdout || '') + String(proc.stderr || ''));

    if (!json) {
        throw new Error('validator did not produce JSON output');
    }

    return parseIssuesFromJson(json, cfg);
}

/**
 * Print one page result
 * @param {{url:string,ok:boolean,errors:Array,warnings:Array}} res - Page result
 * @param {object} cfg - Config
 * @returns {void} - Prints to stdout or stderr
 */
function printPageResult(res, cfg) {
    var green = chalk.green;
    var red = chalk.red;
    var orange = chalk.hex('#FFA500');
    var dim = chalk.dim;

    // Always use absolute file path for clickability if available
    var localFile = urlToFileMap[res.url] || res.url;
    if (!path.isAbsolute(localFile) && fs.existsSync(localFile)) {
        localFile = path.resolve(localFile);
    }

    if (res.ok) {
        console.log(green('  ✔ ' + res.url));
        return;
    }

    console.log(red('  ✖ ' + res.url));

    // Only print errors, message first, then clickable file:line:col in gray
    for (var i = 0; i < res.errors.length; i++) {
        var e = res.errors[i];
        var where = localFile + ':' + (e.line || 0) + (e.col ? ':' + e.col : '');
        // Print error message, then clickable file:line:col in gray
        console.error(red('      ' + e.msg) + ' ' + dim(where));
    }
    // Warnings and extra context omitted for brevity
}

/**
 * Normalize href to absolute and strip hash
 * @param {string} href - Link href
 * @param {string} base - Base url
 * @returns {string|null} - Absolute url or null
 */
function toAbsUrl(href, base) {
    if (!href) { return null; }

    var s = String(href || '').trim();

    if (!s) { return null; }
    if (/^(mailto|tel|javascript|data):/i.test(s)) { return null; }

    try {
        var abs = String(new URL(s, base).href);
        abs = abs.replace(/#.*$/, '');
        return abs;
    } catch (e) {
        return null;
    }
}

/**
 * Decide if a url is crawlable
 * @param {string} href - Absolute url
 * @param {object} cfg - Config
 * @param {string} origin - Allowed origin
 * @returns {boolean} - True if it should be crawled
 */
function isCrawlable(href, cfg, origin) {
    if (!href) { return false; }

    if (!/^https?:\/\//i.test(href)) {
        return false;
    }

    if (cfg && cfg.sameOrigin) {
        try {
            if (new URL(href).origin !== origin) {
                return false;
            }
        } catch (e) {
            return false;
        }
    }

    if (cfg && cfg.stripQuery) {
        if (href.indexOf('?') !== -1) {
            return false;
        }
    }

    if (cfg && cfg.exclude && cfg.exclude.length) {
        for (var i = 0; i < cfg.exclude.length; i++) {
            if (href.indexOf(cfg.exclude[i]) !== -1) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Fetch html with redirect following
 * @param {string} pageUrl - Url to fetch
 * @param {object} cfg - Config
 * @returns {Promise<{finalUrl:string,html:string}>} - Html and final url
 */
async function fetchHtml(pageUrl, cfg) {
    var res = await fetch(pageUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': (cfg && cfg.userAgent) ? cfg.userAgent : 'Mozilla/5.0 (node)' }
    });

    if (!res.ok) {
        throw new Error('request failed ' + res.status + ' ' + pageUrl);
    }

    var finalUrl = (res.url && String(res.url)) ? String(res.url) : pageUrl;
    var html = await res.text();

    return { finalUrl: finalUrl, html: html };
}

/**
 * Save html to temp and return file path
 * @param {string} dir - Temp dir
 * @param {string} pageUrl - Page url
 * @param {string} html - Html content
 * @returns {Promise<string>} - Saved file path
 */
async function saveHtml(dir, pageUrl, html) {
    var name = toSafeName(pageUrl);
    var dest = path.join(dir, name);
    var tmp = dest + '.part';

    // Prettify HTML for readability
    var prettyHtml = beautify(String(html || ''), { indent_size: 2, wrap_line_length: 120 });
    await fsp.writeFile(tmp, prettyHtml, 'utf8');
    try {
        fs.renameSync(tmp, dest);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            // File was not written, skip mapping and print clear message
            console.error(chalk.red('      Failed to save HTML for: ') + pageUrl + chalk.dim(' (no file written)'));
            return null;
        } else {
            throw err;
        }
    }

    // Track mapping for clickable output
    urlToFileMap[pageUrl] = dest;

    return dest;
}

/**
 * Extract links from html
 * @param {string} html - Html content
 * @param {string} baseUrl - Base url
 * @returns {Array<string>} - Absolute links
 */
function extractLinks(html, baseUrl) {
    var $ = cheerio.load(String(html || ''));
    var out = [];
    var seen = Object.create(null);

    $('a[href], area[href]').each(function () {
        var href = $(this).attr('href');
        var abs = toAbsUrl(href, baseUrl);

        if (!abs) {
            return;
        }

        if (!Object.prototype.hasOwnProperty.call(seen, abs)) {
            seen[abs] = true;
            out.push(abs);
        }
    });

    return out;
}

/**
 * A tiny async pool
 * @param {Array<any>} items - Items
 * @param {number} concurrency - Max concurrent
 * @param {function(any):Promise<any>} worker - Worker
 * @returns {Promise<Array<any>>} - Results
 */
async function asyncPool(items, concurrency, worker) {
    var results = [];
    var i = 0;

    if (!items || !items.length) {
        return results;
    }

    concurrency = Math.max(1, parseInt(concurrency, 10) || 1);

    var running = 0;
    var done = 0;

    return new Promise(function (resolve, reject) {

        function next() {
            while (running < concurrency && i < items.length) {
                (function (idx) {
                    running++;

                    Promise.resolve()
                        .then(function () { return worker(items[idx]); })
                        .then(function (res) {
                            results[idx] = res;
                            running--;
                            done++;
                            if (done === items.length) {
                                resolve(results);
                                return;
                            }
                            next();
                        })
                        .catch(function (err) {
                            reject(err);
                        });

                })(i);

                i++;
            }
        }

        next();
    });
}

/**
 * Validate a single page url
 * @param {string} pageUrl - Url
 * @param {object} cfg - Config
 * @param {string} tmpDir - Temp dir
 * @returns {Promise<{url:string,ok:boolean,errors:Array,warnings:Array,finalUrl:string,links:Array}>} - Result
 */
async function validateOneUrl(pageUrl, cfg, tmpDir) {
    var fetched = await fetchHtml(pageUrl, cfg);
    var finalUrl = fetched.finalUrl;
    var html = fetched.html;

    var file = await saveHtml(tmpDir, finalUrl, html);
    var proc = await runOne(file, cfg);

    var issues = parseIssues(proc, cfg);

    var includeWarnings = !cfg.errorsOnly && cfg.warnings > 0;
    var ok = (issues.errors.length === 0 && (!includeWarnings || issues.warnings.length === 0));

    var links = extractLinks(html, finalUrl);

    // Map both the original and final URL to the prettified file
    urlToFileMap[pageUrl] = file;
    urlToFileMap[finalUrl] = file;

    return {
        url: pageUrl,
        finalUrl: finalUrl,
        ok: ok,
        errors: issues.errors,
        warnings: issues.warnings,
        links: links
    };
}

/**
 * Crawl and validate starting from a url
 * @param {string} startUrl - Start url
 * @param {object} cfg - Config
 * @returns {Promise<{passed:number,failed:number,results:Array}>} - Summary
 */
async function validateUrl(startUrl, cfg) {
    cfg = cfg || {};

    if (!(await hasJava())) {
        throw new Error('java not found');
    }

    if (!CURRENT_JAR_PATH) {
        CURRENT_JAR_PATH = await resolveJarPath();
    }

    var origin = '';
    try { origin = new URL(startUrl).origin; } catch (e) { }

    var tmpDir = path.join(os.tmpdir(), 'w3c-validate-html', 'site-' + Date.now());
    ensureDir(tmpDir);

    var seen = Object.create(null);
    var queue = [{ url: startUrl, depth: 0 }];

    var results = [];
    var passed = 0;
    var failed = 0;

    var maxDepth = parseInt(cfg.depth, 10);
    if (isNaN(maxDepth)) { maxDepth = 2; }
    maxDepth = Math.max(0, maxDepth);

    var concurrency = parseInt(cfg.concurrency, 10);
    if (isNaN(concurrency)) { concurrency = 4; }

    if (!cfg.json) {
        var cyan = chalk.cyan;
        var bold = chalk.bold;
        console.log('');
        console.log(bold(cyan('w3c validating html starting at ' + startUrl)));
        console.log('');
    }

    while (queue.length) {

        var batch = [];
        var remaining = [];

        for (var i = 0; i < queue.length; i++) {
            if (batch.length < concurrency) {
                batch.push(queue[i]);
            } else {
                remaining.push(queue[i]);
            }
        }

        queue = remaining;

        /* run a batch */
        var batchResults = await asyncPool(batch, concurrency, async function (job) {

            var u = job.url;
            var d = job.depth;

            if (Object.prototype.hasOwnProperty.call(seen, u)) {
                return null;
            }

            seen[u] = true;

            try {
                var one = await validateOneUrl(u, cfg, tmpDir);
                one.depth = d;
                return one;
            } catch (e) {
                return {
                    url: u,
                    finalUrl: u,
                    depth: d,
                    ok: false,
                    errors: [{ line: 0, col: 0, msg: (e && e.message) ? e.message : String(e) }],
                    warnings: [],
                    links: []
                };
            }
        });

        for (var j = 0; j < batchResults.length; j++) {
            var r = batchResults[j];

            if (!r) {
                continue;
            }

            if (!cfg.json) {
                printPageResult({ url: r.finalUrl, ok: r.ok, errors: r.errors, warnings: r.warnings }, cfg);
            }

            results.push({
                url: r.finalUrl,
                ok: r.ok,
                errors: r.errors,
                warnings: r.warnings
            });

            if (r.ok) {
                passed++;
            } else {
                failed++;
            }

            if (r.depth >= maxDepth) {
                continue;
            }

            for (var k = 0; k < r.links.length; k++) {
                var nextUrl = r.links[k];

                if (!isCrawlable(nextUrl, cfg, origin)) {
                    continue;
                }

                if (Object.prototype.hasOwnProperty.call(seen, nextUrl)) {
                    continue;
                }

                queue.push({ url: nextUrl, depth: r.depth + 1 });
            }
        }
    }

    console.log('');

    return { passed: passed, failed: failed, results: results };
}

/**
 * Expand a path to html files
 * @param {string} target - File or folder
 * @returns {Promise<string[]>} - Absolute html file paths
 */
async function expandFiles(target) {
    var abs = path.resolve(target);

    var st;
    try {
        st = await fsp.stat(abs);
    } catch (e) {
        var msg = (e && e.code === 'ENOENT') ? ('path not found ' + target) : (e && e.message ? e.message : String(e));
        throw new Error(msg);
    }

    if (st.isFile()) {
        if (!/\.html?$/i.test(abs)) {
            throw new Error('not an html file ' + target);
        }
        return [abs];
    }

    return new Promise(function (resolve, reject) {
        glob('**/*.html', { cwd: abs, nodir: true }, function (err, matches) {
            if (err) {
                reject(err);
                return;
            }

            var out = [];
            for (var i = 0; i < matches.length; i++) {
                out.push(path.join(abs, matches[i]));
            }
            resolve(out);
        });
    });
}

/**
 * Validate local html files
 * @param {string} target - File or folder
 * @param {object} cfg - Config
 * @returns {Promise<{passed:number,failed:number,results:Array}>} - Summary
 */
async function validateFiles(target, cfg) {
    cfg = cfg || {};

    if (!(await hasJava())) {
        throw new Error('java not found');
    }

    if (!CURRENT_JAR_PATH) {
        CURRENT_JAR_PATH = await resolveJarPath();
    }

    var files = await expandFiles(target);

    if (!cfg.json) {
        var cyan = chalk.cyan;
        var bold = chalk.bold;
        console.log('');
        console.log(bold(cyan('w3c validating ' + files.length + ' HTML files in ' + target)));
        console.log('');
    }

    var results = [];
    var passed = 0;
    var failed = 0;

    for (var i = 0; i < files.length; i++) {

        var proc = await runOne(files[i], cfg);
        var issues = parseIssues(proc, cfg);

        var includeWarnings = !cfg.errorsOnly && cfg.warnings > 0;
        var ok = (issues.errors.length === 0 && (!includeWarnings || issues.warnings.length === 0));

        var res = {
            url: path.relative(process.cwd(), files[i]) || files[i],
            ok: ok,
            errors: issues.errors,
            warnings: issues.warnings
        };

        if (!cfg.json) {
            printPageResult(res, cfg);
        }

        results.push(res);

        if (ok) {
            passed++;
        } else {
            failed++;
        }
    }

    console.log('');

    return { passed: passed, failed: failed, results: results };
}

/**
 * Check if a string is raw html
 * @param {string} str - input string
 * @returns {boolean} - true if input looks like html
 */
function isHtml(str) {

    if (typeof str !== 'string') return false;

    var s = str.trim();

    if (!s) return false;

    // Must start with '<' (allow whitespace before)
    if (s[0] !== '<') return false;

    // Accept: doctype, comment, or any tag (e.g. <html>, <div>, <svg>, <x-foo>, etc)
    return (
        /^<(!doctype\b|!--|[a-z][\w:-]*\b)/i.test(s)
    );
}

/**
 * Check if a string is a http or https url
 * @param {string} str - input string
 * @returns {boolean} - true if url
 */
function isUrl(str) {
    var s = String(str || '').replace(/^\s+|\s+$/g, '');
    var u;

    if (!/^https?:\/\//i.test(s)) {
        return false;
    }

    u = url.parse(s);
    return !!(u && (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname);
}

/**
 * Check if a string looks like a file or folder path on any os
 * @param {string} str - input string
 * @returns {boolean} - true if file path
 */
function isFilePath(str) {
    var s = String(str || '').replace(/^\s+|\s+$/g, '');

    if (!s || isUrl(s) || isHtml(s)) {
        return false;
    }

    // abs or explicit relative (posix, windows, unc, tilde)
    if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/.test(s)) {
        return true;
    }

    // contains a separator and not just separators
    return /[\\/]/.test(s) && /[^\s\\/]/.test(s);
}


/**
 * Validate a raw HTML string using vnu.jar
 * @param {string} src - The HTML string to validate
 * @param {object} [cfg] - Optional config
 * @returns {Promise<{passed: number, failed: number, results: Array}>} - Validation summary
 */
async function validateHtmlString(src, cfg) {

    if (!(await hasJava())) {
        throw new Error('java not found');
    }

    if (!CURRENT_JAR_PATH) {
        CURRENT_JAR_PATH = await resolveJarPath();
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3c-validate-html-str-'));
    const tmpFile = path.join(tmpDir, 'input.html');
    await fsp.writeFile(tmpFile, src, 'utf8');
    const proc = await runOne(tmpFile, cfg);
    const issues = parseIssues(proc, cfg);
    const includeWarnings = !cfg.errorsOnly && cfg.warnings > 0;
    const ok = (issues.errors.length === 0 && (!includeWarnings || issues.warnings.length === 0));

    try {
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
    }
    catch (e) { }

    const result = {
        ok,
        errors: issues.errors,
        warnings: issues.warnings
    };

    return {
        passed: ok ? 1 : 0,
        failed: ok ? 0 : 1,
        results: [result]
    };
}

/* cli vs module */
if (require.main === module) {

    var argv = minimist(process.argv.slice(2), {
        string: ['target', 'url', 'exclude', 'user-agent'],
        boolean: ['errors-only', 'json', 'same-origin', 'strip-query'],
        alias: { t: 'target', e: 'errors-only' },
        default: {
            target: '',
            depth: 2,
            concurrency: 4,
            warnings: 1,
            exclude: '',
            'errors-only': false,
            json: false,
            'same-origin': true,
            'strip-query': false,
            'user-agent': 'Mozilla/5.0 (node)'
        }
    });

    var target = argv.target;

    if (!target) {
        console.error('usage: w3c-validate-html --target <file|folder|url> [--depth 2] [--concurrency 4] [--warnings 0|1] [--exclude "foo,bar"] [--same-origin] [--strip-query] [--errors-only] [--json]');
        process.exit(1);
    }

    var cfg = {
        depth: parseInt(argv.depth, 10) || 0,
        concurrency: parseInt(argv.concurrency, 10) || 1,
        warnings: parseInt(argv.warnings, 10) || 0,
        exclude: toList(argv.exclude),
        errorsOnly: !!argv['errors-only'],
        json: !!argv.json,
        sameOrigin: argv['same-origin'] !== false,
        stripQuery: !!argv['strip-query'],
        userAgent: argv['user-agent']
    };

    validate(target, cfg).then(function (summary) {
        if (argv.json) {
            try { console.log(JSON.stringify(summary)); }
            catch (e) { console.error('{"error":"failed to stringify results"}'); }
        }
        process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch(function (err) {
        console.error(chalk.red('error') + ' ' + (err && err.message ? err.message : String(err)));
        process.exit(1);
    });

} else {
    module.exports = validate;
}