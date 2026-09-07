#!/usr/bin/env node
/**
 * `config/event_schema.json` に対する実行時検証。
 *
 * 仕様§「JSON SchemaをCIで検証してください」に対応。
 * スキーマは draft 2020-12 で `$ref` と `format` を使うため、
 * 自前実装ではなく ajv を使う（誤りが出やすい部分を持ち込まない）。
 *
 * 使い方：
 *   node scripts/validate-events.mjs                # data/events/current.json
 *   node scripts/validate-events.mjs path/to.json   # 任意のファイル
 */

import { readFileSync, existsSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMA_PATH = process.env.EVENT_SCHEMA ?? 'config/event_schema.json';

export function createValidator(schemaPath = SCHEMA_PATH) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({
    // 全件の誤りを一度に出す。1件ずつ直すのは時間の無駄
    allErrors: true,
    // 生成物なので厳密に見る。未知のキーワードだけは許す
    strictSchema: false,
  });
  addFormats(ajv);
  return ajv.compile(schema);
}

/** @returns {{valid: boolean, errors: string[]}} */
export function validateResearchData(data, schemaPath = SCHEMA_PATH) {
  const validate = createValidator(schemaPath);
  const valid = validate(data);
  return {
    valid: Boolean(valid),
    errors: (validate.errors ?? []).map((error) => {
      const at = error.instancePath || '$';
      const extra = error.params ? ` ${JSON.stringify(error.params)}` : '';
      return `${at}: ${error.message}${extra}`;
    }),
  };
}

/* ------------------------------------------------------------------ CLI */

function main() {
  const target = process.argv[2] ?? 'data/events/current.json';

  if (!existsSync(target)) {
    console.log(`${target} が無いため検証をスキップします（初回実行前は正常です）。`);
    return;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    console.error(`[エラー] ${target} をJSONとして読めません: ${error.message}`);
    process.exit(1);
  }

  const { valid, errors } = validateResearchData(data);

  if (valid) {
    console.log(`検証しました: ${target}／事象 ${data.events?.length ?? 0}件／エラー 0件`);
    return;
  }

  console.error(`[エラー] ${target} が event_schema.json に適合しません（${errors.length}件）`);
  // 同じ原因で大量に出ることがあるので先頭だけ見せる
  for (const message of errors.slice(0, 40)) console.error(`  ${message}`);
  if (errors.length > 40) console.error(`  ...ほか ${errors.length - 40}件`);
  process.exit(1);
}

// 直接実行されたときだけCLIとして動く（テストからは import して使う）
if (process.argv[1] && process.argv[1].endsWith('validate-events.mjs')) main();
