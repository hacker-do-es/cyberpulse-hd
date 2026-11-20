import { describe, it, expect } from 'vitest';
import { toLittleText } from '../services/linkedin/text';

describe('LinkedIn little text format', () => {
  it('escapes markup characters and turns hashtags into real hashtags', () => {
    expect(toLittleText('a (b) [c] {d} <e> @f *g* _h_ ~i~ | \\ j')).toBe('a \\(b\\) \\[c\\] \\{d\\} \\<e\\> \\@f \\*g\\* \\_h\\_ \\~i\\~ \\| \\\\ j');
    expect(toLittleText('#Ciberseguridad y #NIS2.\n#día')).toBe('{hashtag|\\#|Ciberseguridad} y {hashtag|\\#|NIS2}.\n{hashtag|\\#|día}');
    expect(toLittleText('issue#12 and C# stay text')).toBe('issue\\#12 and C\\# stay text');
    expect(toLittleText('🚨 Patch now')).toBe('🚨 Patch now');
  });
});
