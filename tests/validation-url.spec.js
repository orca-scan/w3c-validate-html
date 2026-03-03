const validate = require('../index');
const http = require('http');

describe('w3c-validate-html: url', function () {

    it('should not follow links that look like downloads', async function (done) {
        // Start a local server that serves an HTML page with a link to a download-looking URL
        const html = `<!DOCTYPE html><html><body><a href="/download/file.txt">Download</a></body></html>`;
        const downloadContent = 'This is a file.';
        const server = http.createServer((req, res) => {
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            } else if (req.url === '/download/file.txt') {
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': 'attachment; filename="file.txt"'
                });
                res.end(downloadContent);
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(0, async () => {
            const port = server.address().port;
            const url = `http://localhost:${port}/`;
            const summary = await validate(url, { warnings: 1, depth: 1 });
            // Should only validate the root page, not the /download/file.txt link
            const validatedUrls = summary.results.map(r => r.url || r.finalUrl);
            expect(validatedUrls.some(u => /\/download\//.test(u))).toBe(false);
            server.close(done);
        });
    });

    it('should validate a remote HTML page', async function () {
        const summary = await validate('https://example.com', { warnings: 1, depth: 0 });
        expect(typeof summary.failed).toBe('number');
        expect(typeof summary.passed).toBe('number');
        expect(Array.isArray(summary.results)).toBe(true);
    });

    it('should handle unreachable URLs gracefully', async function () {
        const summary = await validate('http://localhost:9999/this-should-not-exist', { warnings: 1, depth: 0 });
        expect(summary.failed).toBeGreaterThan(0);
        expect(summary.results.some(r => r.errors && r.errors.length > 0)).toBe(true);
    });

    it('should support JSON output for URLs', async function () {
        const summary = await validate('https://example.com', { warnings: 1, depth: 0, json: true });
        expect(typeof summary).toBe('object');
        expect(Array.isArray(summary.results)).toBe(true);
    });
});
