import { describe, expect, it, vi } from 'vitest';

vi.mock('@/data/messages', () => ({ useChatEnabled: vi.fn(), useMessageAccess: vi.fn() }));

const { addAttachments, sendBlocker, tagsOf } = await import('./messagesState');

const access = (over: Partial<{ offline: boolean; send: boolean }> = {}) => ({
  functionId: 'f',
  view: true,
  send: true,
  viewAll: false,
  offline: false,
  load: true,
  ...over,
});

describe('sendBlocker', () => {
  it('tells why nothing can be sent', () => {
    expect(sendBlocker(access(), true)).toBeNull();
    // Unknown while the settings load: the API decides.
    expect(sendBlocker(access(), undefined)).toBeNull();
    expect(sendBlocker(access(), false)).toMatch(/disabled/);
    expect(sendBlocker(access({ send: false }), true)).toMatch(/messages.send/);
    expect(sendBlocker(access({ offline: true }), true)).toMatch(/offline/);
  });
});

describe('tagsOf', () => {
  it('keeps the order and drops unknown tags', () => {
    const t = (id: string) => ({ id, name: id }) as never;
    const byId = new Map([
      ['a', t('a')],
      ['b', t('b')],
    ]);
    const m = { tags: ['b', 'x', 'a'] } as never;
    expect(tagsOf(m, byId).map((x: { id: string }) => x.id)).toEqual(['b', 'a']);
  });
});

describe('addAttachments', () => {
  const file = (name: string, lastModified = 1) => new File(['x'], name, { lastModified });

  it('keeps images and PDFs, whatever the case of the extension', () => {
    const r = addAttachments([], [file('a.png'), file('b.JPG'), file('c.pdf'), file('d.webp')]);
    expect(r.files.map((f) => f.name)).toEqual(['a.png', 'b.JPG', 'c.pdf', 'd.webp']);
    expect(r.error).toBeNull();
  });

  it('leaves out other files and names them', () => {
    const r = addAttachments([file('a.png')], [file('notes.txt'), file('pdf'), file('b.gif')]);
    expect(r.files.map((f) => f.name)).toEqual(['a.png', 'b.gif']);
    expect(r.error).toContain('notes.txt');
    expect(r.error).toContain('pdf:');
  });

  it('keeps a file picked twice once', () => {
    const a = file('a.png');
    expect(addAttachments([a], [file('a.png'), file('a.png', 2)]).files).toHaveLength(2);
  });

  it('stops at ten', () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`p${i}.png`));
    const r = addAttachments([], many);
    expect(r.files).toHaveLength(10);
    expect(r.error).toContain('at most 10');
  });
});
