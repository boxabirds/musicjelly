// The tests' shared reporter: one line per check, and a failing exit code if any failed.
export function checker(title) {
  let failed = 0, count = 0; console.log(title);
  return {
    ok(pass, what, detail = '') { count++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${what}${detail ? ': ' + detail : ''}`); return pass; },
    done() { console.log(failed ? `${failed} of ${count} FAILED` : `all ${count} ok`); if (failed) process.exitCode = 1; },
  };
}
