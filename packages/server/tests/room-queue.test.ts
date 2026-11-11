import { describe, expect, it } from 'vitest';
import { RoomQueue } from '../src/room-queue.js';

describe('RoomQueue (EC-94)', () => {
  it('serializes concurrent tasks for the same roomId', async () => {
    const q = new RoomQueue();
    const order: number[] = [];

    const a = q.run('room-1', async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return 'a';
    });
    const b = q.run('room-1', async () => {
      order.push(3);
      return 'b';
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('a');
    expect(rb).toBe('b');
    expect(order).toEqual([1, 2, 3]);
  });

  it('allows parallel tasks for different rooms', async () => {
    const q = new RoomQueue();
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent -= 1;
    };

    await Promise.all([q.run('a', task), q.run('b', task)]);
    expect(maxConcurrent).toBe(2);
  });
});
