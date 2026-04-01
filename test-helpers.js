function createAsserts() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; return; }
    failed++;
    console.error(`✗ ${msg}`);
  }

  function assertEq(a, b, msg) {
    if (a === b) { passed++; return; }
    failed++;
    console.error(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }

  return {
    assert,
    assertEq,
    stats: () => ({ passed, failed }),
  };
}

module.exports = { createAsserts };
