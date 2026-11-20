import { describe, expect, it } from 'vitest';
import { toLinkedInText } from './linkedinHelpers';

describe('toLinkedInText', () => {
  it('turns Markdown and list markers into plain text with emojis', () => {
    const md = '## **Big news**\n\n- first point\n* second point\n• third\n→ fourth\n1. step one\n2) step two\n---\n#infosec #cybersecurity';
    expect(toLinkedInText(md)).toBe('Big news\n\n▪️ first point\n▪️ second point\n▪️ third\n▪️ fourth\n1️⃣ step one\n2️⃣ step two\n\n#infosec #cybersecurity');
  });
  it('leaves emoji-led lines, hashtags and hyphenated words alone', () => {
    const t = '🔍 Zero-day in FortiOS\n💡 Patch now - really\n#zero-day';
    expect(toLinkedInText(t)).toBe(t);
  });
});
