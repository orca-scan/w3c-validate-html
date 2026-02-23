const path = require('path');
const validate = require('../index');

describe('w3c-validate-html: file', function () {

    it('should validate a valid local HTML file with no errors', async function () {
        const file = path.join(__dirname, 'fixtures', 'valid.html');
        const summary = await validate(file, { warnings: 1 });
        expect(summary.failed).toBe(0);
        expect(summary.passed).toBe(1);
        expect(summary.results[0].errors.length).toBe(0);
    });

    it('should report errors for an invalid local HTML file', async function () {
        const file = path.join(__dirname, 'fixtures', 'invalid.html');
        const summary = await validate(file, { warnings: 1 });
        expect(summary.failed).toBe(1);
        expect(summary.passed).toBe(0);
        expect(summary.results[0].errors.length).toBeGreaterThan(0);
    });

    it('should throw for a missing file', async function () {
        let error;
        try {
            await validate(path.join(__dirname, 'fixtures', 'notfound.html'), { warnings: 1 });
        } catch (e) {
            error = e;
        }
        expect(error).toBeDefined();
    });

    it('should handle a directory of HTML files', async function () {
        const dir = path.join(__dirname, 'fixtures');
        const summary = await validate(dir, { warnings: 1 });
        expect(typeof summary.failed).toBe('number');
        expect(typeof summary.passed).toBe('number');
        expect(Array.isArray(summary.results)).toBe(true);
    });
});
