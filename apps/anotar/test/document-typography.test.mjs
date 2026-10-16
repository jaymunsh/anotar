import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultDocumentTypography, documentTypographyPresets,
  normalizeDocumentTypography, documentTypographyVariables,
} from '../shared/documentTypography.ts';

test('saved typography cannot introduce invalid sizes or inverted heading hierarchy', () => {
  const invalid=normalizeDocumentTypography({bodySize:100,titleRatio:0,h1Ratio:9,h2Ratio:8,h3Ratio:-1,lineHeight:Infinity,spacing:-5});
  assert.equal(invalid.bodySize,18);
  assert.ok(invalid.titleRatio>=invalid.h1Ratio && invalid.h1Ratio>=invalid.h2Ratio && invalid.h2Ratio>=invalid.h3Ratio);
  assert.ok(invalid.lineHeight>=1.4 && invalid.lineHeight<=1.9);
  assert.ok(invalid.spacing>=.75 && invalid.spacing<=1.25);
  assert.deepEqual(normalizeDocumentTypography(null),defaultDocumentTypography);
  assert.deepEqual(normalizeDocumentTypography({bodySize:'18px;background:red',h1Ratio:NaN}),defaultDocumentTypography);
});

test('small is the default, with independent normal and large presets',()=>{
  assert.deepEqual(defaultDocumentTypography,documentTypographyPresets.compact);
  const defaults=documentTypographyVariables(defaultDocumentTypography);
  assert.equal(defaults['--page-type-body'],'14px');
  assert.equal(defaults['--page-type-title'],'28px');
  const normal=documentTypographyVariables(documentTypographyPresets.standard);
  assert.equal(normal['--page-type-body'],'15px');
  assert.equal(normal['--page-type-title'],'32px');
  assert.equal(normal['--page-type-heading-1'],'24px');
  assert.equal(normal['--page-type-heading-2'],'20px');
  assert.equal(normal['--page-type-heading-3'],'17px');
  const compact=documentTypographyVariables(documentTypographyPresets.compact);
  assert.ok(parseFloat(compact['--page-type-body'])<15);
  assert.ok(parseFloat(compact['--page-type-title'])<32);
  assert.ok(parseFloat(compact['--page-type-heading-1'])<24);
  const larger=documentTypographyVariables(documentTypographyPresets.roomy);
  assert.ok(parseFloat(larger['--page-type-body'])>15);
});

test('heading 4 remains larger than body across presets and old saved settings', () => {
  for (const preset of Object.values(documentTypographyPresets)) {
    const vars = documentTypographyVariables(preset);
    assert.ok(parseFloat(vars['--page-type-heading-4']) > parseFloat(vars['--page-type-body']));
    assert.ok(parseFloat(vars['--page-type-heading-4']) < parseFloat(vars['--page-type-heading-3']));
  }
  assert.equal(documentTypographyVariables(documentTypographyPresets.standard)['--page-type-heading-4'], '16px');
  const old = normalizeDocumentTypography({bodySize:14,h3Ratio:1});
  assert.ok(old.h4Ratio > 1 && old.h4Ratio <= old.h3Ratio);
  const invalid = normalizeDocumentTypography({h3Ratio:1.1,h4Ratio:5});
  assert.ok(invalid.h4Ratio > 1 && invalid.h4Ratio <= invalid.h3Ratio);
});
