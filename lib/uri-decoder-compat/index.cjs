// query-string's older CommonJS build expects require(...) to return a function.
// Keep the maintained upstream decoder, including its malformed-input fixes.
const upstream = require('decode-uri-component');
module.exports = typeof upstream === 'function' ? upstream : upstream.default;
