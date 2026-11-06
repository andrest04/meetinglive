import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl } from './youtube-url';

const ID = 'dQw4w9WgXcQ';
const NORMAL = `https://www.youtube.com/watch?v=${ID}`;

describe('parseYouTubeUrl accepts YouTube video links', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`,
    `https://www.youtube.com/watch?v=${ID}&list=PLabc123&index=2`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abcdef&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&feature=share`,
    `https://www.youtube.com/live/${ID}?si=xyz`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/watch?v=${ID}#t=30`,
  ])('%s', (text) => {
    expect(parseYouTubeUrl(text)).toEqual({ url: NORMAL, videoId: ID });
  });
});

describe('parseYouTubeUrl rejects everything else', () => {
  it.each([
    '',
    '   ',
    'not a url',
    `https://vimeo.com/${ID}`,
    `https://www.youtube.com.evil.com/watch?v=${ID}`,
    `https://evil.com/youtube.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    'https://www.youtube.com/playlist?list=PLabc123',
    'https://www.youtube.com/watch?list=PLabc123',
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}!`,
    `ftp://www.youtube.com/watch?v=${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `file:///C:/youtu.be/${ID}`,
    `https://user@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8080/watch?v=${ID}`,
    `https://www.youtube.com/channel/UC123`,
    `https://www.youtube.com/`,
    'https://youtu.be/',
    `https://youtu.be/${ID}/extra`,
    `https://www.youtube.com/watch?v=${ID} https://youtu.be/${ID}`,
  ])('%j', (text) => {
    expect(parseYouTubeUrl(text)).toBeNull();
  });
});
