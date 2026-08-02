// Every module the browser loads has to parse.
//
// Not every file here is imported by a test: the *-page.js modules touch document
// at import time, so they cannot be loaded in node, and a syntax error in one of
// them sails past a green suite and lands on the reader as a blank page. That
// happened -- a backtick inside an HTML comment inside a template literal closed
// the literal early, and the whole chronology page rendered nothing while 285
// tests stayed green.
//
// The obvious tool for this does not work. `node --check <file>` silently exits 0
// for any .js file containing a top-level `import`, which is every module here --
// verified by appending `const broken = (((;` to a real one and watching it pass.
// Feeding the source in on stdin with an explicit --input-type=module is what
// actually parses it, and that is what the same mutation fails under.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIRS = ['public/js', 'worker'];

const modules = DIRS.flatMap((dir) => {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.js') && !n.startsWith('test_'))
    .map((n) => `${dir}/${n}`);
});

test('there are modules to check at all', () => {
  // A glob that silently matched nothing would make every assertion below pass,
  // which is the same failure this file exists to prevent, one level up.
  assert.ok(modules.length >= 10, `expected the site's modules, found ${modules.length}`);
});

for (const file of modules) {
  test(`${file} parses`, () => {
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'],
                   { input: readFileSync(file), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      assert.fail(`${file} does not parse:\n${error.stderr?.toString() || error.message}`);
    }
  });
}
