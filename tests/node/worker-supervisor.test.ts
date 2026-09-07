import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { superviseProcesses } from '../../scripts/worker-supervisor.mjs';

function fixture() {
  const runtime = Object.assign(new EventEmitter(), { exit: (code: number) => { exits.push(code); } });
  const exits: number[] = [];
  const child = () => Object.assign(new EventEmitter(), { signals: [] as string[], kill(signal: string) { this.signals.push(signal); } });
  const a = child(), b = child();
  const supervisor = superviseProcesses({ runtime });
  supervisor.add(a, 'sibyl'); supervisor.add(b, 'workers');
  return { runtime, exits, a, b };
}

test('deploy shutdown waits for both child processes', () => {
  const { runtime, exits, a, b } = fixture();
  runtime.emit('SIGTERM');
  a.emit('exit', 0, 'SIGTERM'); a.emit('close');
  assert.deepEqual(exits, []);
  assert.deepEqual(b.signals, ['SIGTERM']);
  b.emit('exit', 0, 'SIGTERM'); b.emit('close');
  assert.deepEqual(exits, [0]);
});

test('unexpected clean child exit still fails and stops the sibling', () => {
  const { exits, a, b } = fixture();
  a.emit('exit', 0, null); a.emit('close');
  assert.deepEqual(b.signals, ['SIGTERM']);
  b.emit('exit', 0, 'SIGTERM'); b.emit('close');
  assert.deepEqual(exits, [1]);
});

test('spawn error shuts down the fleet without an unhandled error', () => {
  const { exits, a, b } = fixture();
  a.emit('error', new Error('ENOENT')); a.emit('close');
  b.emit('exit', 0, 'SIGTERM'); b.emit('close');
  assert.deepEqual(exits, [1]);
});
