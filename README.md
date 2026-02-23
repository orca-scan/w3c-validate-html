# w3c-validate-html

[![Tests](https://github.com/orca-scan/w3c-validate-html/actions/workflows/ci.yml/badge.svg)](https://github.com/orca-scan/w3c-validate-html/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/orca-scan/w3c-validate-html)](https://github.com/orca-scan/w3c-validate-html/blob/master/LICENSE)
[![npm](https://img.shields.io/npm/v/w3c-validate-html)](https://www.npmjs.com/package/w3c-validate-html)

Validate HTML offline using the official W3C vnu.jar

**Why?** Modern build tools can introduce HTML bugs. w3c-validate-html runs locally and prints concise, clickable errors with line numbers using the same rules as the online W3C validator, but entirely offline.

---

## CLI

The easiest way to use this is from the CLI using `npx`, for example:

```sh
# Validate a website recursively (default depth 2)
npx w3c-validate-html --url https://example.com --depth 1 --concurrency 2

# Validate a folder, fail only on errors
npx w3c-validate-html --target ./public --errors-only
```

### Options

Option        | Alias | Type    | Default            | Description
:-------------|:------|:--------|:-------------------|:-------------------------------------
--url         | -u    | string  |                    | Start URL for website validation
--target      | -t    | string  |                    | File or folder to validate
--depth       |       | number  | 2                  | Crawl depth for website validation
--concurrency |       | number  | 4                  | Number of concurrent validations
--warnings    |       | 0\|1    | 1                  | Show warnings (0 = off, 1 = on)
--exclude     |       | string  |                    | Comma/space separated URLs to exclude
--errors-only | -e    | boolean | false              | Only show errors
--json        |       | boolean | false              | Output results as JSON
--same-origin |       | boolean | true               | Restrict crawl to same origin
--strip-query |       | boolean | false              | Exclude URLs with query strings
--user-agent  |       | string  | Mozilla/5.0 (node) | Custom user agent for requests

---

## Output

Errors and warnings are printed with clickable file:line:col references for easy navigation in editors. Downloaded HTML is prettified for readability. Exits with code 1 if validation fails.

Example output:

```
  ✖ public/invalid.html
      End tag for  "h1" seen, but there were unclosed elements. public/invalid.html:7:5
      Unclosed element "h1". public/invalid.html:7:5
      End of file seen when expecting text or an end tag. public/invalid.html:9:1
  ✔ public/valid.html
```

---

## Node module

You can use this package as a module to validate a URL, file/folder, or raw HTML string:

### Validate a URL

```js
const validate = require('w3c-validate-html');

(async () => {
  const summary = await validate('https://example.com', { warnings: 1, depth: 0 });
  console.log(summary);
})();
```

### Validate a local file or folder

```js
const validate = require('w3c-validate-html');

(async () => {
  const summary = await validate('./tests/fixtures/valid.html', { warnings: 1 });
  console.log(summary);
})();
```

### Validate a raw HTML string

```js
const validate = require('w3c-validate-html');

(async () => {
  const html = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hi</h1></body></html>';
  const result = await validate(html);
  console.log(result);
  // {
  //   passed: 1,
  //   failed: 0,
  //   results: [
  //     { ok: true, errors: [], warnings: [] }
  //   ]
  // }
})();
```

### Example response (invalid HTML file)

```json
{
  "passed": 0,
  "failed": 1,
  "results": [
    {
      "ok": false,
      "errors": [
        { "line": 7, "col": 5, "msg": "End tag for  \"h1\" seen, but there were unclosed elements." },
        { "line": 7, "col": 5, "msg": "Unclosed element \"h1\"." },
        { "line": 9, "col": 1, "msg": "End of file seen when expecting text or an end tag." }
      ],
      "warnings": []
    }
  ]
}
```

---

## Requirements

- Node.js (14+)
- Java (for vnu.jar)

---

## License

[MIT License](LICENSE) © Orca Scan - a [barcode app](https://orcascan.com) with simple [barcode tracking APIs](https://orcascan.com/guides?tag=for-developers).
