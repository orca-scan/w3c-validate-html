const path = require('path');
const validate = require('../index');

describe('w3c-validate-html: interface', function () {

    it('should export a function', function () {
        expect(typeof validate).toEqual('function');
    });

    it('should accept (target, options)', function () {
        expect(validate.length).toBe(2);
    });

    it('should return a Promise', function () {
        const file = path.join(__dirname, 'fixtures', 'valid.html');
        const result = validate(file, { warnings: 1 });
        expect(typeof result.then).toBe('function');
    });

    it('should throw if no target is provided', async function () {
        let error;
        try {
            await validate();
        } catch (e) {
            error = e;
        }
        expect(error).toBeDefined();
    });
});