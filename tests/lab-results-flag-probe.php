<?php
/**
 * PrimeCare - CLI probe used by tests/lab-results-smoke-test.mjs
 * Phase 5.10.2 (remediation): exercises the pure clinical-flag and reference-range logic with no
 * database access, including exact boundary values.
 *
 * Usage: C:\xampp\php\php.exe tests/lab-results-flag-probe.php
 * Output: JSON list of { name, pass, detail }.
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers/lab_results.php';

$cases = [];

/** Assert calculateLabFlag() outcome: expected is a flag, or false for rejection. */
$flag = static function (string $name, mixed $result, ?float $min, ?float $max, ?string $manual, string|false $expected, ?bool $expectConflict = null) use (&$cases): void {
    $r    = calculateLabFlag($result, $min, $max, $manual);
    $pass = $expected === false
        ? empty($r['ok'])
        : (!empty($r['ok']) && ($r['flag'] ?? null) === $expected);
    if ($pass && $expectConflict !== null) {
        $pass = (!empty($r['conflict'])) === $expectConflict;
    }
    $cases[] = ['name' => $name, 'pass' => $pass, 'detail' => json_encode($r)];
};

/** Assert parseLabReferenceRange() outcome: expected is [min,max] floats, null (no range) or false (rejected). */
$range = static function (string $name, array $input, array|null|false $expected) use (&$cases): void {
    $r = parseLabReferenceRange($input);
    if ($expected === false) {
        $pass = empty($r['ok']) && !empty($r['message']);
    } elseif ($expected === null) {
        $pass = !empty($r['ok']) && $r['min'] === null && $r['max'] === null;
    } else {
        $pass = !empty($r['ok']) && $r['min'] === $expected[0] && $r['max'] === $expected[1];
    }
    $cases[] = ['name' => $name, 'pass' => $pass, 'detail' => json_encode($r)];
};

// Range 0..10: span 10, critical threshold 3 -> critical below -3 / above 13 (strict)
$flag('0..10: value == min is Normal', '0', 0.0, 10.0, null, 'Normal');
$flag('0..10: value == max is Normal', '10', 0.0, 10.0, null, 'Normal');
$flag('0..10: mid value is Normal', '5', 0.0, 10.0, null, 'Normal');
$flag('0..10: just above max is Abnormal', '10.01', 0.0, 10.0, null, 'Abnormal');
$flag('0..10: just below min is Abnormal', '-0.01', 0.0, 10.0, null, 'Abnormal');
$flag('0..10: exactly max+30% (13) is Abnormal, not Critical', '13', 0.0, 10.0, null, 'Abnormal');
$flag('0..10: exactly min-30% (-3) is Abnormal, not Critical', '-3', 0.0, 10.0, null, 'Abnormal');
$flag('0..10: just beyond max+30% (13.01) is Critical', '13.01', 0.0, 10.0, null, 'Critical');
$flag('0..10: just beyond min-30% (-3.01) is Critical', '-3.01', 0.0, 10.0, null, 'Critical');
// Range 70..100: span 30, threshold 9 -> critical above 109 / below 61
$flag('70..100: 109 is Abnormal', '109', 70.0, 100.0, null, 'Abnormal');
$flag('70..100: 109.01 is Critical', '109.01', 70.0, 100.0, null, 'Critical');
$flag('70..100: 61 is Abnormal', '61', 70.0, 100.0, null, 'Abnormal');
$flag('70..100: 60.99 is Critical', '60.99', 70.0, 100.0, null, 'Critical');
// Range with decimals (frontend-style data)
$flag('13.8..17.2: 13.5 is Abnormal (seeded LAB-001)', '13.5', 13.8, 17.2, null, 'Abnormal');
$flag('0..200: 180 is Normal (seeded LAB-002)', '180', 0.0, 200.0, null, 'Normal');

// H1: a manual flag may never override the computed flag when a range exists
$flag('conflict: Normal manual on critical value is rejected', '9.9', 3.5, 5.0, 'Normal', false, true);
$flag('conflict: Abnormal manual on critical value is rejected', '6.1', 3.5, 5.0, 'Abnormal', false, true);
$flag('conflict: Critical manual on normal value is rejected', '4.0', 3.5, 5.0, 'Critical', false, true);
$flag('matching manual flag (any case) is accepted', '9.9', 3.5, 5.0, 'critical', 'Critical');
$flag('blank manual flag falls back to computed', '9.9', 3.5, 5.0, '   ', 'Critical');

// Invalid ranges and flags
$flag('min == max is rejected', '5', 5.0, 5.0, null, false);
$flag('min > max is rejected', '5', 10.0, 2.0, null, false);
$flag('invalid manual flag rejected (with range)', '4.0', 3.5, 5.0, 'High', false);
$flag('invalid manual flag rejected (without range)', 'Positive', null, null, 'High', false);
$flag('half range (min only) rejected by calculator', '4.0', 3.5, null, 'Normal', false);
$flag('half range (max only) rejected by calculator', '4.0', null, 5.0, 'Normal', false);

// No usable range: never invent a threshold
$flag('no range + no flag is rejected', '42', null, null, null, false);
$flag('no range + valid manual flag is honoured', '42', null, null, 'Abnormal', 'Abnormal');
$flag('non-numeric result + range needs a flag', 'Positive', 0.0, 10.0, null, false);
$flag('non-numeric result + range + manual flag is honoured', 'Positive', 0.0, 10.0, 'Abnormal', 'Abnormal');

// M1: reference-range parsing
$range('nested numeric strings accepted', ['referenceRange' => ['min' => '70', 'max' => '100']], [70.0, 100.0]);
$range('nested numbers accepted', ['referenceRange' => ['min' => 0.6, 'max' => 1.2]], [0.6, 1.2]);
$range('flat refRangeMin/Max accepted', ['refRangeMin' => '3.5', 'refRangeMax' => '5'], [3.5, 5.0]);
$range('bounds rounded to stored precision (2dp)', ['referenceRange' => ['min' => '0.125', 'max' => '1.999']], [0.13, 2.0]);
$range('absent range is "no range"', ['result' => '1'], null);
$range('null referenceRange is "no range"', ['referenceRange' => null], null);
$range('blank-string bounds are "no range"', ['referenceRange' => ['min' => '', 'max' => '  ']], null);
$range('partial: min only rejected', ['referenceRange' => ['min' => '3', 'max' => '']], false);
$range('partial: max only rejected', ['referenceRange' => ['min' => null, 'max' => '8']], false);
$range('partial: flat min only rejected', ['refRangeMin' => '3'], false);
$range('non-numeric min rejected', ['referenceRange' => ['min' => 'abc', 'max' => '8']], false);
$range('non-numeric max rejected', ['referenceRange' => ['min' => '1', 'max' => '8mg']], false);
$range('non-finite (INF) rejected', ['referenceRange' => ['min' => 'INF', 'max' => '8']], false);
$range('absurdly large bound rejected', ['referenceRange' => ['min' => '1', 'max' => '1e12']], false);
$range('boolean bound rejected', ['referenceRange' => ['min' => true, 'max' => '8']], false);
$range('array bound rejected', ['referenceRange' => ['min' => [1], 'max' => '8']], false);
$range('non-object referenceRange rejected', ['referenceRange' => '3-8'], false);

// M4: category whitelist helpers
$cases[] = ['name' => 'category: canonical spelling accepted', 'pass' => normalizeLabCategory('Hematology') === 'Hematology', 'detail' => ''];
$cases[] = ['name' => 'category: case-insensitive match is canonicalised', 'pass' => normalizeLabCategory('urinalysis') === 'Urinalysis', 'detail' => ''];
$cases[] = ['name' => 'category: unsupported value rejected', 'pass' => normalizeLabCategory('Radiology') === null, 'detail' => ''];

echo json_encode($cases, JSON_UNESCAPED_SLASHES);

