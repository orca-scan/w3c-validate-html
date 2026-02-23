const path = require('path');
const validate = require('../index');

describe('w3c-validate-html: html', function () {

    it('should validate a raw HTML string', async function () {
        const html = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hi</h1></body></html>';
        const result = await validate(html);
        expect(result.passed).toBe(1);
        expect(result.failed).toBe(0);
        expect(Array.isArray(result.results)).toBe(true);
        expect(result.results.length).toBe(1);
        expect(result.results[0].ok).toBe(true);
        expect(Array.isArray(result.results[0].errors)).toBe(true);
    });
});
