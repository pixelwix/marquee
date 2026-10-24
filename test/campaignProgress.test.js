const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const modulePath = '../tools/scripts-agent/campaign-progress.mjs';
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-'));
  const write = (file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  return { dir, write, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('scoped movie counts exclude historical completions and preserve holds and pending searches', async () => {
  const { movieBatchProgress } = await import(modulePath); const f = fixture();
  try {
    f.write('settings.json', { search_scope: { enabled: true, requestedAt: 100, movies: Object.fromEntries([1,2,3,4,5,6].map(id => [id, { fileId: id, bytes: 12e9, title: 'private title' }])) } });
    f.write('audit-review-decisions.json', { 4: { fileId: 4, action: 'hold' } });
    f.write('status.json', { time: '2026-10-24T10:00:00-05:00' });
    f.write('state.json', { movies: {
      1: { status: 'verified_unmonitored', oldFileId: 1, verifiedFileId: 11, newBytes: 8e9 },
      2: { status: 'queued', release: 'secret URL' },
      3: { status: 'no_candidate', lastAttempt: 101 },
      4: { status: 'failed' }, 5: { status: 'no_candidate', lastAttempt: 99 },
      6: { status: 'verified_unmonitored', oldFileId: 60, verifiedFileId: 66, newBytes: 8e9 },
      999: { status: 'verified_unmonitored' },
    } });
    const r = movieBatchProgress(f.dir, new Date('2026-10-24T15:10:00Z'));
    assert.deepEqual([r.enrolled,r.completed,r.queued,r.waiting,r.held,r.pending,r.remaining,r.savedGB], [6,1,1,1,2,1,5,4]);
    assert.equal(r.stale,false); assert.ok(!JSON.stringify(r).includes('secret')); assert.ok(!JSON.stringify(r).includes('private title'));
    assert.equal(movieBatchProgress(f.dir,new Date('2026-10-24T16:00:00Z')).stale,true);
    f.write('state.json',null); assert.equal(movieBatchProgress(f.dir).available,false);
    f.write('settings.json',{}); assert.equal(movieBatchProgress(f.dir),null);
  } finally { f.close(); }
});
test('HEVC totals separate verified, excluded, queued, retries and unresolved failures', async () => {
  const { hevcProgress, campaignForJob } = await import(modulePath); const f=fixture();
  try {
    f.write('library-hevc-state.json',{ episodes: {
      a:{status:'verified',verified:{fileId:2,savedGB:3}},b:{status:'submitted'},c:{status:'retry-pending'},
      d:{status:'payload-held'},e:{status:'pending'},f:{status:'held'},g:{status:'verified'},h:{status:'exhausted'},
    } });
    f.write('library-hevc-status.json',{at:'2026-10-24T10:00:00-0500'});
    const r=hevcProgress(f.dir,'library',new Date('2026-10-24T15:05:00Z'));
    assert.deepEqual([r.enrolled,r.completed,r.queued,r.waiting,r.held,r.pending,r.excluded,r.savedGB],[7,1,1,1,3,1,1,3]);
    assert.equal(r.stale,false);assert.equal(campaignForJob('unrelated.py',f.dir),null);
    fs.writeFileSync(path.join(f.dir,'library-hevc-status.json'),'bad');assert.equal(hevcProgress(f.dir,'library').available,false);
  } finally { f.close(); }
});
test('campaign display escapes labels, keeps unavailable and stale reports explicit', () => {
  const source=fs.readFileSync(path.join(__dirname,'../public/admin.js'),'utf8');
  const fn=source.slice(source.indexOf('function campaignProgressHtml('),source.indexOf('\nfunction renderScripts()'));
  const ctx={escapeHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')};vm.createContext(ctx);vm.runInContext(fn,ctx);
  assert.equal(ctx.campaignProgressHtml(null),'');
  assert.match(ctx.campaignProgressHtml({title:'Test',available:false}),/temporarily unavailable/);
  const html=ctx.campaignProgressHtml({available:true,title:'<script>',unit:'movies',enrolled:78,remaining:74,completed:4,queued:2,waiting:16,held:1,pending:55,savedGB:10,stale:true});
  assert.ok(!html.includes('<script>'));assert.match(html,/Stale report/);assert.match(html,/held for review/);assert.match(html,/4 of 78 verified complete/);
});
