# w3c-validate-html

A fast, CLI tool for validating HTML files and websites using the official W3C validator (vnu.jar).

## Features
- Validates local HTML files or entire folders
- Validates remote websites recursively (with configurable depth)
- Prettifies downloaded HTML for easy review
- Outputs clickable file:line:col errors and warnings for editors/terminals
- Supports concurrency for fast crawling
- Handles warnings, errors, and info messages
- Excludes URLs or restricts to same-origin
- JSON output for integration

## Installation

```bash
npm install
yarn install
```

## Usage

### Validate a website

```bash
node index.js --url https://example.com --depth 2 --concurrency 4 --warnings 1
```

### Validate local files or folders

```bash
node index.js --target ./public --warnings 1
```

### Options

| Option        | Description                           | Default            |
|---------------|---------------------------------------|--------------------|
| --url         | Start URL for website validation      |                    |
| --target      | File or folder to validate            |                    |
| --depth       | Crawl depth for website validation    | 2                  |
| --concurrency | Number of concurrent validations      | 4                  |
| --warnings    | Show warnings (0 = off, 1 = on)       | 1                  |
| --exclude     | Comma/space separated URLs to exclude |                    |
| --errors-only | Only show errors                      | false              |
| --json        | Output results as JSON                | false              |
| --same-origin | Restrict crawl to same origin         | true               |
| --strip-query | Exclude URLs with query strings       | false              |
| --user-agent  | Custom user agent for requests        | Mozilla/5.0 (node) |

## Output

- Errors and warnings are printed with clickable file:line:col references for easy navigation in editors.
- Downloaded HTML is prettified for readability.

## Requirements
- Node.js (14+)
- Java (for vnu.jar)

## License

[MIT License](LICENSE) © Orca Scan - a [barcode app](https://orcascan.com) with simple [barcode tracking APIs](https://orcascan.com/guides?tag=for-developers).

## Programmatic Usage

You can use this package as a module to validate a URL, file/folder, or raw HTML string. The exported function auto-detects the input type:

### Validate a URL

```js
const validate = require('w3c-validate-html');

(async () => {
  const summary = await validate('https://example.com');
  console.log(summary);
})();
```

### Validate a local file or folder

```js
const validate = require('w3c-validate-html');

(async () => {
  const summary = await validate('./index.html');
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
  // { ok: true, errors: [], warnings: [] }
})();
```