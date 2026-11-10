/* Direct EJS render checks for the Messages inbox template (no server needed).
   Covers branches hard to reach live: a "New match!" row, a photo preview,
   the LoveLink platform row, and the true empty state. */
const ejs = require('ejs');
const path = require('path');

const t = (k) => ({
  messages: 'Messages', searchMessages: 'Search messages...',
  noChatsFound: 'No chats found', noChatsFoundHint: 'Try a different name or word',
  newMatch: 'New match!', photo: 'Photo', discover: 'Discover',
}[k] || k);
const nt = (s) => (typeof s === 'string' ? s : '');
const icon = (n) => '<svg class="ico">' + n + '</svg>';

let failed = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra && !cond ? ' :: ' + extra : ''));
  if (!cond) failed++;
}

async function main() {
  const file = path.join(__dirname, 'views', 'messages-inbox.ejs');
  const rows = [
    { kind: 'chat', href: '/messages/1', name: 'Ruth', thumb: '/img/x.jpg', online: true, unread: 1,
      previewKind: 'new', previewText: '', timeLabel: '6:21 AM', lastAt: new Date() },
    { kind: 'chat', href: '/messages/2', name: 'Hanna', thumb: null, online: false, unread: 0,
      previewKind: 'photo', previewText: '', timeLabel: '11/08/26', lastAt: new Date() },
    { kind: 'chat', href: '/messages/3', name: 'Selam', thumb: '/img/y.jpg', online: true, unread: 0,
      previewKind: 'text', previewText: 'How you doing', timeLabel: '6:20 AM', lastAt: new Date() },
    { kind: 'platform', href: '/messages/platform/9', name: 'LoveLink', verified: true, online: true, unread: 2,
      previewKind: 'platform', previewRaw: 'Welcome to LoveLink!', timeLabel: '11/08/26', lastAt: new Date() },
  ];
  const html = await ejs.renderFile(file, { rows, t, nt, icon });
  check('centered title', html.includes('class="msg-title"'));
  check('search input + placeholder', html.includes('id="msg-search-input"') && html.includes('Search messages...'));
  check('no old section-head', !html.includes('section-head'));
  check('no old chat-item class', !html.includes('chat-item'));
  check('new-match row renders pink New match!', html.includes('msg-prev-new') && html.includes('New match!'));
  check('new-match has heart + sparkles icons', html.includes('>heart<') && html.includes('>sparkles<'));
  check('photo preview renders "Photo"', html.includes('>Photo<'));
  check('platform row: LoveLink + verified badge', html.includes('LoveLink') && html.includes('verified-badge'));
  check('platform preview text', html.includes('Welcome to LoveLink!'));
  check('online dots present', (html.match(/msg-dot/g) || []).length === 3); // Ruth, Selam, LoveLink
  check('unread badges 1 and 2', html.includes('>1<') && html.includes('>2<'));
  check('time labels', html.includes('6:21 AM') && html.includes('11/08/26'));
  check('no-results block present but hidden', html.includes('id="msg-noresults"') && html.includes('hidden'));
  check('search JS present', html.includes('msg-search-input') && html.includes("addEventListener('input'"));

  const empty = await ejs.renderFile(file, { rows: [], t, nt, icon });
  check('empty state renders when no rows', empty.includes('No chats yet') && empty.includes('/discover'));
  check('empty state has no search bar', !empty.includes('msg-search-input'));

  if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
  console.log('render checks: all pass');
}
main().catch((e) => { console.error(e); process.exit(1); });
