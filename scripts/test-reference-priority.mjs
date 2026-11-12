import assert from 'node:assert/strict';
import {
  prepareVideoPayload,
  REFERENCE_PRIORITY_INSTRUCTION,
} from '../server/src/muse.js';

const plain = { prompt: '一只猫走过街道', duration: 5 };
const plainPrepared = prepareVideoPayload(plain);
assert.deepEqual(plainPrepared, plain);
assert.notEqual(plainPrepared, plain);

const referenced = {
  prompt: '人物穿红色裙子',
  duration: 10,
  images: [{ url: 'data:image/png;base64,AAAA' }],
};
const referencedPrepared = prepareVideoPayload(referenced);
assert.equal(
  referencedPrepared.prompt,
  `${REFERENCE_PRIORITY_INSTRUCTION}\n\n${referenced.prompt}`,
);
assert.equal(referenced.prompt, '人物穿红色裙子');
assert.deepEqual(referencedPrepared.images, referenced.images);

const stringReference = prepareVideoPayload({
  prompt: '保持人物一致',
  images: ['/uploads/reference.png'],
});
assert.ok(stringReference.prompt.startsWith(REFERENCE_PRIORITY_INSTRUCTION));

const preparedAgain = prepareVideoPayload(referencedPrepared);
assert.equal(preparedAgain.prompt, referencedPrepared.prompt);

const emptyReference = prepareVideoPayload({ prompt: '纯文本生成', images: ['', null, {}] });
assert.equal(emptyReference.prompt, '纯文本生成');

console.log('Reference-priority video prompt test passed');
