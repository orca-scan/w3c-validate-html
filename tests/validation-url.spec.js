const validate = require('../index');

describe('w3c-validate-html: url', function () {

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
