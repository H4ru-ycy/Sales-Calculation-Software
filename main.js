(function(){
"use strict";

/* ---------- storage (アプリ内→localStorage→メモリ) ---------- */
var mem = {};
var backend = (function(){
  try{ if(typeof window.storage !== "undefined" && window.storage) return "app"; }catch(e){}
  try{ localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return "local"; }catch(e){}
  return "mem";
})();
var hasStore = backend === "app";
async function sget(k){
  try{
    if(backend === "app"){ var r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; }
    if(backend === "local"){ var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
  }catch(e){}
  return mem[k] !== undefined ? mem[k] : null;
}
async function sset(k,v){
  try{
    if(backend === "app"){ await window.storage.set(k, JSON.stringify(v)); return true; }
    if(backend === "local"){ localStorage.setItem(k, JSON.stringify(v)); return true; }
  }catch(e){ mem[k]=v; return false; }
  mem[k]=v; return true;
}
async function sdel(k){
  try{
    if(backend === "app"){ await window.storage.delete(k); }
    else if(backend === "local"){ localStorage.removeItem(k); }
  }catch(e){}
  delete mem[k];
}
/* 同期保存（ページを閉じる直前の保険用） */
function ssetSync(k,v){
  try{ if(backend === "local"){ localStorage.setItem(k, JSON.stringify(v)); return; } }catch(e){}
  mem[k]=v;
}

var IDX = "sales:index";
var LAST = "sales:lastOpen";
var KEY = function(id){ return "sales:session:" + id; };

/* ---------- state ---------- */
var index = [];
var sess = null;
var selId = null;
var lastTotal = 0;

/* ---------- utils ---------- */
var $ = function(id){ return document.getElementById(id); };
var yen = function(n){ return "¥" + Number(n||0).toLocaleString("ja-JP"); };
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function todayISO(){
  var d = new Date(), p = function(x){ return String(x).padStart(2,"0"); };
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
}
function fmtDate(iso){
  if(!iso) return "";
  var p = iso.split("-");
  return p.length===3 ? (p[1]*1)+"/"+(p[2]*1) : iso;
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
var toastT;
function toast(msg){
  var t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove("on"); }, 1800);
}
function total(s){
  return (s.items||[]).reduce(function(a,i){ return a + i.price * i.qty; }, 0);
}
function count(s){
  return (s.items||[]).reduce(function(a,i){ return a + i.qty; }, 0);
}

/* ---------- home ---------- */
async function loadIndex(){
  index = (await sget(IDX)) || [];
  renderHome();
  var lastId = await sget(LAST);
  if(lastId){
    var s = await sget(KEY(lastId));
    if(s && !s.locked){ openEditor(s); return; }
    sdel(LAST);
  }
}
function renderHome(){
  var list = $("fileList");
  $("fileCount").textContent = index.length ? index.length + "件" : "";
  if(!index.length){
    list.innerHTML = '<li class="empty">まだファイルがありません。<br>上のフォームから作成してください。</li>';
    return;
  }
  var sorted = index.slice().sort(function(a,b){
    return (b.date||"").localeCompare(a.date||"") || b.createdAt - a.createdAt;
  });
  list.innerHTML = sorted.map(function(f){
    return '<li><button class="filecard" data-open="'+f.id+'">'+
      '<div class="fmeta">'+
        '<div class="fname">'+
          '<span class="badge '+(f.locked?"done":"open")+'">'+(f.locked?"記録済":"作成中")+'</span>'+
          esc(f.name)+
        '</div>'+
        '<div class="fsub num">'+esc(f.date||"日付なし")+'</div>'+
      '</div>'+
      '<div class="ftotal num">'+yen(f.total)+'</div>'+
    '</button></li>';
  }).join("");
}

/* ---------- editor ---------- */
function openEditor(s){
  sess = s; selId = null; lastTotal = -1;
  sset(LAST, s.id);
  $("home").classList.add("hidden");
  $("inventory").classList.add("hidden");
  $("utility").classList.add("hidden");
  $("tabbar").classList.remove("hidden");
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function(t){
    t.classList.toggle("on", t.dataset.view === "home");
  });
  document.body.classList.add("in-editor");
  curView = "editor";
  measureTabbar();
  $("editor").classList.remove("hidden");
  $("footer").classList.remove("hidden");
  $("sessTitle").textContent = s.name;
  $("sessDate").textContent = s.date || "";
  $("lockBanner").classList.toggle("hidden", !s.locked);
  $("addPanel").classList.toggle("hidden", !!s.locked);
  $("footer").classList.toggle("locked", !!s.locked);
  $("finishBtn").disabled = !!s.locked;
  $("finishBtn").textContent = s.locked ? "記録済み" : "終了する";
  $("totLabel").textContent = s.locked ? "会計数" : "売上";
  $("curLabel").textContent = s.locked ? "売上合計" : "今の会計";
  if(!s.checkoutBase) s.checkoutBase = {};
  updateCheckoutBtn();
  setItemKind("");
  renderItems(); renderTotal();
  extPush();
  window.scrollTo(0,0);
}
function backHome(){
  sess = null; selId = null; curView = "home";
  sdel(LAST);
  $("editor").classList.add("hidden");
  $("footer").classList.add("hidden");
  showView("home");
  renderHome();
}
/* ---------- タブ / ビュー切替 ---------- */
var curView = "home";
function measureTabbar(){
  requestAnimationFrame(function(){
    var h = $("tabbar").offsetHeight;
    if(h) document.documentElement.style.setProperty("--tab-h", h + "px");
  });
}
window.addEventListener("resize", measureTabbar);
function showView(name){
  // ファイルを開いたまま他のタブへ移って「計算」に戻ったら、そのファイルの計算画面へ
  if(name === "home" && sess){ if(curView !== "editor") openEditor(sess); return; }
  document.body.classList.remove("in-editor");
  curView = name;
  $("editor").classList.add("hidden");
  $("footer").classList.add("hidden");
  ["home","inventory","utility"].forEach(function(v){
    $(v).classList.toggle("hidden", v !== name);
  });
  $("tabbar").classList.remove("hidden");
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function(t){
    t.classList.toggle("on", t.dataset.view === name);
  });
  if(name === "inventory") renderInventory();
  if(name === "utility") refreshExtUI();
  window.scrollTo(0,0);
}
document.addEventListener("click", function(e){
  var tab = e.target.closest(".tab[data-view]");
  if(tab){ showView(tab.dataset.view); }
});
function renderItems(){
  var el = $("itemList");
  if(!sess.items.length){
    el.innerHTML = '<div class="empty">'+(sess.locked
      ? "商品が登録されないまま記録されました。"
      : "商品がまだありません。<br>上のフォームから追加してください。")+'</div>';
    return;
  }
  el.innerHTML = sess.items.map(function(it){
    var sel = it.id === selId && !sess.locked;
    // 取り込んだ商品（invId付き）は在庫管理ストアの在庫を正として表示
    var linked = it.invId ? inventory.find(function(x){ return x.id === it.invId; }) : null;
    var hasStock, left, out, stockTxt;
    if(linked && typeof linked.stock === "number"){
      hasStock = true; left = linked.stock; out = left <= 0;
      stockTxt = '<span class="stock'+(out?" out":(left<=3?" low":""))+'">在庫 <b class="num">'+left+'</b></span>';
    } else if(!linked && typeof it.stock === "number"){
      hasStock = true; left = it.stock - it.qty; out = left <= 0;
      stockTxt = '<span class="stock'+(out?" out":(left<=3?" low":""))+'">在庫 <b class="num">'+left+'</b> / '+it.stock+'</span>';
    } else {
      hasStock = false; left = null; out = false;
      stockTxt = '<span class="stock none">在庫管理なし</span>';
    }
    // 商品カードの個数・金額は「今の会計（1会計分）」を表示。確定後はリセットされる
    var base = (sess.checkoutBase && sess.checkoutBase[it.id]) || 0;
    var curQty = sess.locked ? it.qty : (it.qty - base);
    return '<div class="item'+(sel?" sel":"")+'" data-id="'+it.id+'">'+
      '<button class="item-head" data-sel="'+it.id+'">'+
        '<div class="item-name"><div class="n">'+esc(it.name)+'</div>'+
          '<div class="p num">'+yen(it.price)+' / 点　'+stockTxt+'</div></div>'+
        '<div class="item-qty">×<b class="num">'+curQty+'</b></div>'+
        '<div class="item-sub num">'+yen(it.price*curQty)+'</div>'+
      '</button>'+
      '<div class="pad">'+
        '<div class="padtag">今の会計'+(hasStock?'　／　在庫 残り '+left+' 点':'')+'</div>'+
        '<div class="padrow">'+
          '<button class="step minus" data-minus="'+it.id+'"'+(curQty<=0?" disabled":"")+'>−</button>'+
          '<div class="padcount num">'+curQty+'</div>'+
          '<button class="step plus" data-plus="'+it.id+'"'+(out?" disabled":"")+'>＋</button>'+
        '</div>'+
        (out?'<div class="soldout">在庫がなくなりました</div>':'')+
        '<div class="itemtools"><button data-del="'+it.id+'">この商品を削除</button></div>'+
      '</div>'+
    '</div>';
  }).join("");
}
function renderTotal(){
  if(sess.locked){
    // 記録済み：会計数と売上合計を表示
    var salesAll = total(sess), nc = (sess.checkouts||[]).length;
    $("salesVal").innerHTML = nc + '<small style="margin-left:3px">会計</small>';
    $("curVal").innerHTML = '<small>¥</small>' + salesAll.toLocaleString("ja-JP");
    $("curSub").textContent = count(sess) + "点 / " + sess.items.length + "商品";
    lastTotal = salesAll;
    return;
  }
  // 売上＝確定した会計の合計、今の会計＝計算中の1会計分
  var sales = (sess.checkouts||[]).reduce(function(a,c){ return a+(c.amount||0); }, 0);
  var cur = currentCheckout();
  var curCount = cur.items.reduce(function(a,i){ return a+i.qty; }, 0);
  $("salesVal").innerHTML = '<small>¥</small>' + sales.toLocaleString("ja-JP");
  var v = $("curVal");
  v.innerHTML = '<small>¥</small>' + cur.total.toLocaleString("ja-JP");
  if(cur.total !== lastTotal && lastTotal !== -1){
    v.classList.remove("bump"); void v.offsetWidth; v.classList.add("bump");
  }
  lastTotal = cur.total;
  $("curSub").textContent = curCount + "点 / " + cur.items.length + "商品";
}
async function persist(){
  if(!sess) return;
  await sset(KEY(sess.id), sess);
  var row = index.find(function(f){ return f.id === sess.id; });
  if(row){ row.total = total(sess); row.locked = sess.locked; row.name = sess.name; row.date = sess.date; }
  await sset(IDX, index);
}

/* ---------- actions ---------- */
$("newDate").value = todayISO();

$("createBtn").addEventListener("click", async function(){
  var name = $("newName").value.trim();
  var date = $("newDate").value;
  if(!name) name = date ? fmtDate(date) + " の売上" : "無題のファイル";
  var s = { id: uid(), name: name, date: date, items: [], locked: false,
            createdAt: Date.now(), closedAt: null };
  index.push({ id: s.id, name: s.name, date: s.date, total: 0, locked: false, createdAt: s.createdAt });
  await sset(KEY(s.id), s);
  await sset(IDX, index);
  $("newName").value = "";
  openEditor(s);
});

$("fileList").addEventListener("click", async function(e){
  if(suppressClick){ suppressClick = false; return; }
  var b = e.target.closest("[data-open]");
  if(!b) return;
  var s = await sget(KEY(b.dataset.open));
  if(!s){ toast("ファイルを読み込めませんでした"); return; }
  openEditor(s);
});

/* 長押しで削除 */
var pressTimer = null, pressed = null, suppressClick = false, startY = 0;
function pressStart(e){
  var card = e.target.closest("[data-open]");
  if(!card) return;
  startY = e.touches ? e.touches[0].clientY : e.clientY;
  pressed = card; suppressClick = false;
  card.classList.add("pressing");
  pressTimer = setTimeout(function(){
    pressTimer = null; suppressClick = true;
    card.classList.remove("pressing");
    if(navigator.vibrate) try{ navigator.vibrate(18); }catch(err){}
    askDeleteFile(card.dataset.open);
    setTimeout(function(){ suppressClick = false; }, 700);
  }, 550);
}
function pressEnd(){
  clearTimeout(pressTimer); pressTimer = null;
  if(pressed){ pressed.classList.remove("pressing"); pressed = null; }
}
function pressMove(e){
  var y = e.touches ? e.touches[0].clientY : e.clientY;
  if(Math.abs(y - startY) > 10) pressEnd();
}
var fl = $("fileList");
fl.addEventListener("touchstart", pressStart, {passive:true});
fl.addEventListener("touchmove", pressMove, {passive:true});
fl.addEventListener("touchend", pressEnd);
fl.addEventListener("touchcancel", pressEnd);
fl.addEventListener("mousedown", pressStart);
fl.addEventListener("mousemove", pressMove);
fl.addEventListener("mouseup", pressEnd);
fl.addEventListener("mouseleave", pressEnd);
fl.addEventListener("contextmenu", function(e){ e.preventDefault(); });

function askDeleteFile(id){
  var f = index.find(function(x){ return x.id === id; });
  if(!f) return;
  confirmDialog({
    title: "このファイルを削除しますか？",
    body: "削除すると元に戻せません。",
    recap: '<div><span>'+esc(f.name)+'</span><span class="num">'+esc(f.date||"—")+'</span></div>'+
           '<div class="big"><span>合計</span><span class="num">'+yen(f.total)+'</span></div>',
    ok: "削除する", danger: true,
    onOk: async function(){
      index = index.filter(function(x){ return x.id !== id; });
      await sdel(KEY(id));
      await sset(IDX, index);
      renderHome();
      toast("削除しました");
    }
  });
}

$("backBtn").addEventListener("click", backHome);

$("addItemBtn").addEventListener("click", async function(){
  var name = $("itemName").value.trim();
  var priceRaw = $("itemPrice").value;
  var stockRaw = $("itemStock").value.trim();
  var price = Math.max(0, Math.round(Number(priceRaw) || 0));
  var stock = stockRaw === "" ? null : Math.max(0, Math.round(Number(stockRaw) || 0));
  if(!name) name = "商品 " + (sess.items.length + 1);
  var it = { id: uid(), name: name, price: price, qty: 0, stock: stock, kind: newItemKind };
  sess.items.push(it);
  selId = it.id;
  $("itemName").value = ""; $("itemPrice").value = ""; $("itemStock").value = "";
  setItemKind("");
  renderItems(); renderTotal(); await persist();
  extPush();
  document.querySelector('[data-id="'+it.id+'"]').scrollIntoView({behavior:"smooth", block:"center"});
});

/* ===== 在庫管理から商品リストへ取り込み ===== */
var pickSel = {};
$("importInvBtn").addEventListener("click", openInvPicker);
function openInvPicker(){
  if(!sess || sess.locked) return;
  inventory = loadInv();
  pickSel = {};
  var imported = {};
  (sess.items||[]).forEach(function(it){ if(it.invId) imported[it.invId] = true; });
  if(!inventory.length){
    sheet("在庫管理から追加",
      '<div class="empty" style="margin-top:4px">まだ頒布物が登録されていません。<br>先に「在庫管理」タブで登録してください。</div>');
    return;
  }
  sheet("在庫管理から追加",
    '<input id="pickSearch" class="pick-search" type="search" placeholder="タイトル・イベント名で絞り込み" autocomplete="off">'+
    '<div id="pickList" class="pick-list"></div>'+
    '<button class="btn btn-primary" id="pickAddBtn" style="margin-top:14px">選択した商品を追加</button>');
  renderPickList(imported, "");
  $("pickSearch").addEventListener("input", function(){ renderPickList(imported, this.value); });
  $("pickList").addEventListener("click", function(e){
    var row = e.target.closest(".pickrow[data-id]"); if(!row) return;
    if(row.classList.contains("done")) return;
    var id = row.dataset.id;
    if(pickSel[id]) delete pickSel[id]; else pickSel[id] = true;
    row.classList.toggle("on", !!pickSel[id]);
    var ck = row.querySelector(".pk-check"); if(ck) ck.textContent = pickSel[id] ? "✓" : "";
    updatePickCount();
  });
  $("pickAddBtn").addEventListener("click", doImport);
}
function renderPickList(imported, q){
  q = (q||"").trim().toLowerCase();
  var host = $("pickList");
  var rows = inventory.filter(function(it){
    return !q || ((it.title||"")+" "+(it.event||"")).toLowerCase().indexOf(q) >= 0;
  }).slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||"") || (b.createdAt||0)-(a.createdAt||0); });
  if(!rows.length){ host.innerHTML = '<div class="empty" style="margin:0">条件に合う頒布物がありません。</div>'; return; }
  host.innerHTML = rows.map(function(it){
    var done = !!imported[it.id];
    var stockTxt = it.stock===null ? "在庫管理なし" : ("在庫 "+it.stock);
    return '<div class="pickrow'+(done?" done":(pickSel[it.id]?" on":""))+'" data-id="'+it.id+'">'+
      '<div class="pk-check">'+(done?"✓":(pickSel[it.id]?"✓":""))+'</div>'+
      '<div class="pk-main">'+
        '<div class="pk-title">'+esc(it.title)+invKindBadge(it.kind)+'</div>'+
        '<div class="pk-sub">'+(it.event?esc(it.event)+' ／ ':'')+yen(it.price)+' ／ '+esc(stockTxt)+(done?' <b>（追加済み）</b>':'')+'</div>'+
      '</div></div>';
  }).join("");
}
function updatePickCount(){
  var n = Object.keys(pickSel).length, b = $("pickAddBtn");
  if(b) b.textContent = n ? ("選択した "+n+" 件を追加") : "選択した商品を追加";
}
async function doImport(){
  var ids = Object.keys(pickSel);
  if(!ids.length){ toast("追加する頒布物を選んでください"); return; }
  var added = 0, lastId = null;
  ids.forEach(function(iid){
    var inv = inventory.find(function(x){ return x.id === iid; });
    if(!inv) return;
    var it = { id: uid(), name: inv.title, price: inv.price, qty: 0,
               stock: null, kind: inv.kind || "", invId: inv.id };
    sess.items.push(it); lastId = it.id; added++;
  });
  if(lastId) selId = lastId;
  $("menuRoot").innerHTML = "";
  renderItems(); renderTotal(); await persist(); extPush();
  toast(added + "件を商品リストに追加しました");
  var card = lastId && document.querySelector('[data-id="'+lastId+'"]');
  if(card) card.scrollIntoView({behavior:"smooth", block:"center"});
}

/* 種類セグメント */
var newItemKind = "";
function setItemKind(k){
  newItemKind = k;
  var seg = $("itemKindSeg");
  if(!seg) return;
  Array.prototype.forEach.call(seg.querySelectorAll("[data-kind]"), function(b){
    b.classList.toggle("on", b.dataset.kind === k);
  });
}
$("itemKindSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-kind]"); if(!b) return;
  setItemKind(b.dataset.kind);
});

$("itemStock").addEventListener("keydown", function(e){
  if(e.key === "Enter") $("addItemBtn").click();
});

$("itemPrice").addEventListener("keydown", function(e){
  if(e.key === "Enter") $("addItemBtn").click();
});

$("itemList").addEventListener("click", async function(e){
  if(sess.locked) return;
  var t = e.target;
  var sel = t.closest("[data-sel]"), plus = t.closest("[data-plus]"),
      minus = t.closest("[data-minus]"), del = t.closest("[data-del]");

  if(plus || minus){
    var id = (plus||minus).dataset.plus || (plus||minus).dataset.minus;
    var it = sess.items.find(function(x){ return x.id === id; });
    if(!it) return;
    var linked = it.invId ? inventory.find(function(x){ return x.id === it.invId; }) : null;
    if(plus){
      if(linked && typeof linked.stock === "number"){
        if(linked.stock <= 0){ toast("在庫がありません"); return; }
        linked.stock -= 1; saveInv();           // 在庫管理タブの在庫を実際に1減らす
      } else if(!linked && typeof it.stock === "number" && it.qty >= it.stock){
        toast("在庫がありません"); return;
      }
      it.qty += 1;
    } else { // minus：今の会計分の中だけ戻せる（確定済みの会計は減らさない）
      var base = (sess.checkoutBase && sess.checkoutBase[it.id]) || 0;
      if(it.qty - base <= 0) return;
      if(linked && typeof linked.stock === "number"){ linked.stock += 1; saveInv(); } // 在庫を戻す
      it.qty -= 1;
    }
    renderItems(); renderTotal(); await persist();
    extPush();
    return;
  }
  if(del){
    var it2 = sess.items.find(function(x){ return x.id === del.dataset.del; });
    confirmDialog({
      title: "この商品を削除しますか？",
      body: "「"+esc(it2.name)+"」と数えた "+it2.qty+"点 が消えます。",
      ok: "削除する", danger: true,
      onOk: async function(){
        // 取り込んだ商品を削除するときは、数えた分の在庫を在庫管理に戻す
        if(it2 && it2.invId && it2.qty > 0){
          var lk = inventory.find(function(x){ return x.id === it2.invId; });
          if(lk && typeof lk.stock === "number"){ lk.stock += it2.qty; saveInv(); }
        }
        sess.items = sess.items.filter(function(x){ return x.id !== del.dataset.del; });
        if(selId === del.dataset.del) selId = null;
        renderItems(); renderTotal(); await persist(); toast("削除しました");
      }
    });
    return;
  }
  if(sel){
    selId = (selId === sel.dataset.sel) ? null : sel.dataset.sel;
    renderItems();
    if(selId){
      var card = document.querySelector('[data-id="'+selId+'"]');
      if(card) card.scrollIntoView({behavior:"smooth", block:"center"});
    }
  }
});

/* ---------- finish ---------- */
$("finishBtn").addEventListener("click", function(){
  if(sess.locked) return;
  var open = currentCheckout();            // 未確定の会計（確定はOK時のみ）
  var t = total(sess), c = count(sess);
  var nCheckouts = (sess.checkouts||[]).length + (open.total > 0 ? 1 : 0);
  confirmDialog({
    title: "この内容で終了しますか？",
    body: (open.total>0 ? "計算中の会計（¥"+open.total.toLocaleString("ja-JP")+"）も記録します。" : "")
          + "終了すると保存され、あとから編集できません。",
    recap: '<div><span>'+esc(sess.name)+'</span><span class="num">'+esc(sess.date||"—")+'</span></div>'+
           (nCheckouts ? '<div><span>会計数</span><span class="num">'+nCheckouts+'回</span></div>' : '')+
           '<div><span>点数</span><span class="num">'+c+'点</span></div>'+
           '<div class="big"><span>売上合計</span><span class="num">'+yen(t)+'</span></div>',
    ok: "終了して保存する",
    onOk: async function(){
      // 計算中の会計があれば最後の1会計として確定
      if(open.total > 0){
        if(!sess.checkoutBase) sess.checkoutBase = {};
        (sess.items||[]).forEach(function(it){ sess.checkoutBase[it.id] = it.qty; });
        if(!sess.checkouts) sess.checkouts = [];
        sess.checkouts.push({ amount:open.total, count:open.items.reduce(function(a,i){return a+i.qty;},0), ts:Date.now() });
      }
      sess.locked = true; sess.closedAt = Date.now(); selId = null;
      await persist();
      openEditor(sess);
      toast("記録しました");
    }
  });
});

/* ---------- dialog ---------- */
function confirmDialog(o){
  var root = $("dialogRoot");
  root.innerHTML =
    '<div class="scrim"><div class="dialog" role="dialog" aria-modal="true">'+
      '<h4>'+o.title+'</h4>'+
      '<p>'+o.body+'</p>'+
      (o.recap ? '<div class="recap">'+o.recap+'</div>' : '')+
      '<div class="acts">'+
        '<button class="btn '+(o.danger?"btn-danger":"btn-primary")+'" id="dlgOk">'+o.ok+'</button>'+
        '<button class="btn btn-ghost" id="dlgNo">キャンセル</button>'+
      '</div>'+
    '</div></div>';
  var close = function(){ root.innerHTML = ""; };
  $("dlgNo").addEventListener("click", close);
  $("dlgOk").addEventListener("click", function(){ close(); o.onOk(); });
  root.querySelector(".scrim").addEventListener("click", function(e){
    if(e.target === this) close();
  });
  $("dlgOk").focus();
}

/* ---------- menu ---------- */
var APP_VER = "Ver.2.4";
var X_ID = "H4ru_ycy";
var MAIL = "h4ru.kyi2943@gmail.com";
var THEME_KEY = "sales:theme";

/* ---------- theme ---------- */
var THEMES = [
  ["light", "ライト（通常）", "sw-light", "明るい標準の表示"],
  ["dark",  "ダーク",        "sw-dark",  "暗めで目にやさしい"],
  ["navy",  "ネイビー",      "sw-navy",  "落ち着いた濃紺"],
  ["mocha", "モカ",          "sw-mocha", "あたたかみのある茶系"],
  ["auto",  "端末に合わせる","sw-auto",  "スマホの設定に自動で追従"]
];
var themeMode = "light";
var mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function applyTheme(){
  var t = themeMode;
  if(t === "auto") t = (mql && mql.matches) ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
}
function setTheme(mode){
  themeMode = mode; applyTheme();
  try{ localStorage.setItem(THEME_KEY, JSON.stringify(mode)); }catch(e){}
}
function themeLabel(){
  for(var i=0;i<THEMES.length;i++){ if(THEMES[i][0]===themeMode) return THEMES[i][1]; }
  return "ライト（通常）";
}
if(mql && mql.addEventListener){ mql.addEventListener("change", function(){ if(themeMode==="auto") applyTheme(); }); }
try{ var _pt = localStorage.getItem(THEME_KEY); if(_pt){ themeMode = JSON.parse(_pt); applyTheme(); } }catch(e){}

function sheet(title, inner, backTo){
  $("menuRoot").innerHTML =
    '<div class="sheetwrap"><div class="bg" data-close></div><div class="sheet" role="dialog" aria-modal="true">'+
      '<div class="sheet-top">'+
        (backTo ? '<button class="sheet-close" data-back aria-label="戻る">‹</button>' : '')+
        '<h3>'+title+'</h3>'+
        '<button class="sheet-close" data-close aria-label="閉じる">✕</button>'+
      '</div>'+ inner +
    '</div></div>';
}
function closeSheet(){ $("menuRoot").innerHTML = ""; }

function menuHome(){
  sheet("メニュー",
    '<button class="menu-item" data-go="help"><span class="ic">？</span>使い方<span class="chev">›</span></button>'+
    '<button class="menu-item" data-go="theme"><span class="ic">◐</span>表示モード<span class="chev">'+themeLabel()+' ›</span></button>'+
    '<button class="menu-item" data-go="contact"><span class="ic">✉</span>お問い合わせ<span class="chev">›</span></button>'+
    '<div class="sheet-ver">売上計算ツール '+APP_VER+'</div>'+
    '<div class="menu-foot"><button class="verhist-btn" data-go="history">バージョン履歴 ›</button></div>');
}
function menuHistory(){
  var log = [
    ["Ver.2.4", "最新", [
      "待機スライドショーの画像を売上計算ツールから追加・削除・並べ替えできるように（最大20枚、外部ディスプレイへ自動送信）",
      "毎日つなぎ直しても、登録済みの画像は接続時に自動で送り直す",
      "ファイルを開いて計算している間も下部タブを表示。計算の途中でユーティリティ（お知らせ表示など）へ移って、「計算」タブでそのまま戻れるように"
    ]],
    ["Ver.2.3", "", [
      "ユーティリティに「待機スライドショー」を追加：外部ディスプレイの待機中スライドショーのON/OFFと1枚あたりの秒数（2〜120秒）をこの端末から変更",
      "ユーティリティに「お知らせ表示」を追加：「サークル主離席中」などを手入力し、文字の色・背景の色・大きさを指定して外部ディスプレイ全面に表示",
      "お知らせはプレビューで確認→OKで表示。「解除」で通常の表示に戻る"
    ]],
    ["Ver.2.2", "", [
      "計算画面をレジ方式に刷新：下部の左に「売上（確定した会計の合計）」、右に「今の会計」を表示",
      "商品カードの個数・金額は1会計ごとの表示に（会計完了で×0にリセット）",
      "「会計完了」を常時表示。押すと今の会計が売上に加算され、次の会計へ。外部ディスプレイは従来どおり"
    ]],
    ["Ver.2.1", "", [
      "計算で売れた分だけ、在庫管理タブの在庫も実際に減るように同期（＋で実在庫−1、−で戻る）",
      "取り込んだ商品を削除すると、数えた分の在庫を在庫管理に戻す"
    ]],
    ["Ver.2.0", "", [
      "計算画面に「在庫管理から選んで追加」を追加。登録した頒布物（タイトル・単価・在庫数・種類）をまとめて商品リストに取り込めるように",
      "取り込んだ商品は在庫数を引き継ぎ、＋／−で在庫がリアルタイムに増減。手入力での追加も引き続き可能"
    ]],
    ["Ver.1.9", "", [
      "計算中、商品カードに在庫を「在庫 残り数 / 全体数」で表示し、＋／−でリアルタイムに増減",
      "残りの在庫数を大きく見やすく表示（残り3以下で黄色、0で赤色）"
    ]],
    ["Ver.1.8", "", [
      "外部出力をレジ方式に変更：外部ディスプレイは「今の会計」だけを表示（売上総額は表示しない）",
      "計算画面に「会計完了」ボタンを追加（外部出力ON時）。押すと1会計分を記録し、外部表示は¥0にリセット",
      "手元の暫定合計・商品リスト・販売数は従来どおり累計のまま",
      "終了時に会計数と売上合計を表示"
    ]],
    ["Ver.1.7", "", [
      "在庫管理を「頒布物の登録場所」に刷新（タイトル・単価・在庫数・種類・日付・イベント名）",
      "頒布物をカード表示し、長押しで編集・削除できるように",
      "種類に「委託」を追加（在庫管理・ホーム共通）",
      "在庫はイベントごとに独立して管理"
    ]],
    ["Ver.1.6", "", [
      "外部ディスプレイ（sale-sync）とのリアルタイム同期に対応",
      "8桁PIN／QRコードで接続し、計算中の内容を約0.7秒ごとに送信",
      "商品の種類（新刊／既刊）も外部ディスプレイへ送信",
      "接続情報を保存し、9時間有効・次回起動時も同期を継続"
    ]],
    ["Ver.1.5", "", [
      "画面下部にタブバーを追加（ホーム／在庫管理／ユーティリティ）",
      "在庫管理：登録した全商品を横断一覧・検索・種類で絞り込み",
      "商品に種類（新刊／既刊）を登録できるように",
      "CSV出力に対応（Excel等で開けるファイル書き出し・コピー）",
      "バックアップ / 引き継ぎ（別端末へのデータ移行）を追加",
      "外部出力：ON/OFFトグルとQRコード読み取り（PIN接続）の土台を追加"
    ]],
    ["Ver.1.4", "", [
      "メニューのどの項目を選んでも表示モード画面が開いてしまう不具合を修正"
    ]],
    ["Ver.1.3", "", [
      "記録の保存を強化し、ページを閉じても消えないように（端末内に保存）",
      "次に開いたとき、作業していたファイルを自動で開いて続きから再開",
      "アプリを切り替えた瞬間・タブを閉じる直前にも自動保存",
      "ホーム画面に追加するとアプリのように全画面で起動"
    ]],
    ["Ver.1.2", "", [
      "表示モードを追加（ライト／ダーク／ネイビー／モカ／端末に合わせる）",
      "選んだモードを保存し、次回起動時も維持",
      "画面全体を配色対応にして各モードで見やすく調整"
    ]],
    ["Ver.1.1", "", [
      "商品ごとに在庫数を登録できるように",
      "「＋」で在庫が減り、「－」で戻る（残り数・完売表示つき）",
      "保存したファイルを長押しで削除できるように",
      "使い方の説明を更新"
    ]],
    ["Ver.1.0", "初期リリース", [
      "商品名・値段を登録し、「＋」「－」で計算",
      "暫定合計金額をリアルタイム表示",
      "商品をタップで選択・強調して計算",
      "日程ごとにファイル分け（ファイル名・日付を入力）",
      "「終了」ボタンで保存（確認ダイアログつき・以降編集不可）",
      "ハンバーガーメニュー（使い方・お問い合わせ）を搭載"
    ]]
  ];
  var body = '<div class="changelog">' + log.map(function(v){
    var tag = v[1] ? '<span class="cl-tag'+(v[1]==="最新"?" now":"")+'">'+v[1]+'</span>' : '';
    var items = v[2].map(function(t){ return '<li>'+t+'</li>'; }).join("");
    return '<div class="cl-item"><div class="cl-head"><span class="cl-ver">'+v[0]+'</span>'+tag+'</div>'+
           '<ul class="cl-list">'+items+'</ul></div>';
  }).join("") + '</div>'+
  '<div class="sheet-ver">売上計算ツール '+APP_VER+'</div>';
  sheet("バージョン履歴", body, true);
}
function menuTheme(){
  var opts = THEMES.map(function(t){
    return '<button class="themeopt'+(themeMode===t[0]?" on":"")+'" data-settheme="'+t[0]+'">'+
      '<span class="sw '+t[2]+'"></span>'+
      '<span>'+t[1]+'<span class="themedesc">'+t[3]+'</span></span>'+
      (themeMode===t[0]?'<span class="mark">✓</span>':'')+
    '</button>';
  }).join("");
  sheet("表示モード",
    opts + '<div class="note">選んだモードは保存され、次に開いたときも同じ表示になります。</div>', true);
}
function menuHelp(){
  sheet("使い方",
    '<div class="note" style="margin-top:0"><b>おすすめの手順</b>'+
      'ファイルを作ったら、まず先に在庫（頒布物）をすべて登録してから数え始めるとスムーズです。'+
      'イベント中に慌てて登録せずに済みます。</div>'+
    '<ol class="howto" style="margin-top:10px">'+
      '<li><b>ファイルを作る</b>ファイル名と日付を入れて「このファイルを開く」。日程やイベントごとに分けて記録できます。</li>'+
      '<li><b>在庫（頒布物）を登録する</b>商品名・値段・在庫数・種類（新刊／既刊）を入れて「リストに追加」。商品名・在庫数・種類は未入力でもOK（在庫を入れない場合は在庫管理なし）。</li>'+
      '<li><b>商品を選ぶ</b>商品カードをタップすると、その商品が黄色で強調され計算パッドが開きます。</li>'+
      '<li><b>数える</b>売れたら「＋」で在庫が1つ減ります。間違えたら「－」で取り消し、在庫も戻ります。下のバーに暫定合計がすぐ反映されます。</li>'+
      '<li><b>終了する</b>「終了する」を押すと確認画面が出ます。保存後は編集できません。</li>'+
    '</ol>'+
    '<div class="note"><b>下のタブについて</b>'+
      '・<b style="display:inline">計算</b>：ファイルの作成・一覧と、頒布物を数える画面。<br>'+
      '・<b style="display:inline">在庫管理</b>：登録した全商品を横断で一覧。タイトルやイベント名で検索、新刊／既刊で絞り込みできます。<br>'+
      '・<b style="display:inline">ユーティリティ</b>：CSV出力・バックアップ・外部出力の設定。</div>'+
    '<div class="note" style="margin-top:10px"><b>CSV出力（ユーティリティ）</b>'+
      '・すべての記録をCSVファイルで書き出せます。Excelやスプレッドシートで開けます。<br>'+
      '・fileが使えない環境では「コピー」で貼り付け用に出力できます。</div>'+
    '<div class="note" style="margin-top:10px"><b>バックアップ / 引き継ぎ（ユーティリティ）</b>'+
      '・記録はこの端末内に保存されます。別の端末へ移すときは、ここで書き出したデータを移動先で読み込みます。<br>'+
      '・fileの保存／コピーのどちらでも移せます。</div>'+
    '<div class="note" style="margin-top:10px"><b>外部出力（ユーティリティ）</b>'+
      '・別端末の「外部ディスプレイ」に、計算中の合計や商品をリアルタイム表示できます。<br>'+
      '・使い方：トグルをON →「QRコードを読み取って接続」またはディスプレイに出た<b style="display:inline">8桁のPIN</b>を入力。<br>'+
      '・接続後は、＋／－や商品追加が自動でディスプレイに反映されます（認証は1日1回・9時間有効）。<br>'+
      '・単独で使うときはOFFのままでOKです。</div>'+
    '<div class="note" style="margin-top:10px"><b>待機スライドショー / お知らせ表示（ユーティリティ）</b>'+
      '・待機スライドショー：会計していない間に外部ディスプレイで画像を順番に表示。ON/OFF・秒数・画像（追加／削除／並べ替え、最大20枚）をここで設定。画像は接続中の外部ディスプレイへ自動で送られます。<br>'+
      '・お知らせ表示：「サークル主離席中」などを入力し、文字の色・背景・大きさを選んでプレビュー → OKで外部ディスプレイ全面に表示。「解除」で元に戻ります。</div>'+
    '<div class="note" style="margin-top:10px"><b>在庫について</b>'+
      '・カードに「残り〇」と表示されます。残り3以下で黄色、0で赤色になります。<br>'+
      '・在庫が0になると「＋」は押せなくなります。<br>'+
      '・在庫数を入れずに追加すれば、在庫を気にせず数えられます。</div>'+
    '<div class="note" style="margin-top:10px"><b>覚えておくと便利</b>'+
      '・操作するたび自動保存されるので、途中で閉じても続きから開けます。<br>'+
      '・一覧に戻っても記録は消えません。「作成中」のファイルはあとから再開できます。<br>'+
      '・<b style="display:inline">保存したファイルを長押しすると削除</b>できます（確認画面が出ます）。<br>'+
      '・表示モード（ライト／ダーク／ネイビー／モカ）はメニューから切り替えられます。<br>'+
      '・商品ごと消したいときは、選択中パネルの「この商品を削除」から。</div>', true);
}
function menuContact(){
  sheet("お問い合わせ",
    '<p class="contact-lead">不具合の報告やご要望は、下のどちらかからご連絡ください。</p>'+
    '<a class="link-card" href="https://x.com/'+X_ID+'" target="_blank" rel="noopener noreferrer">'+
      '<span class="ic">𝕏</span><span><span class="lc-t">X（旧Twitter）</span>'+
      '<span class="lc-v">@'+X_ID+'</span></span></a>'+
    '<a class="link-card" href="mailto:'+MAIL+'">'+
      '<span class="ic">✉</span><span><span class="lc-t">メール</span>'+
      '<span class="lc-v">'+MAIL+'</span></span></a>'+
    '<div class="sheet-ver">売上計算ツール '+APP_VER+'</div>', true);
}

document.addEventListener("click", function(e){
  if(e.target.closest("[data-menu]")){ menuHome(); return; }
  var root = $("menuRoot");
  if(!root.firstChild) return;
  if(e.target.closest("[data-close]")){ closeSheet(); return; }
  if(e.target.closest("[data-back]")){ menuHome(); return; }
  var th = e.target.closest("[data-settheme]");
  if(th){ setTheme(th.dataset.settheme); menuTheme(); return; }
  var go = e.target.closest("[data-go]");
  if(go){
    var g = go.dataset.go;
    if(g === "help") menuHelp();
    else if(g === "theme") menuTheme();
    else if(g === "history") menuHistory();
    else menuContact();
  }
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape") closeSheet();
});

/* ページを離れる直前に、今の状態を確実に保存（バックグラウンド化・タブ終了の保険） */
function safetySave(){
  try{
    if(sess){
      ssetSync(KEY(sess.id), sess);
      ssetSync(LAST, sess.id);
      var row = index.find(function(f){ return f.id === sess.id; });
      if(row){ row.total = total(sess); row.locked = sess.locked; }
      ssetSync(IDX, index);
    }
  }catch(e){}
}
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState === "hidden") safetySave();
});
window.addEventListener("pagehide", safetySave);
window.addEventListener("beforeunload", safetySave);

/* ============ 在庫管理 ============ */
async function allSessions(){
  var out = [];
  for(var i=0;i<index.length;i++){
    var s = await sget(KEY(index[i].id));
    if(s) out.push(s);
  }
  return out;
}
var invFilterKind = "", invQuery = "";

/* 在庫ストア（在庫管理タブで一元登録。イベントごとに独立） */
var INV_KEY = "sales:inventory";
function loadInv(){ try{ return JSON.parse(localStorage.getItem(INV_KEY)||"[]"); }catch(e){ return []; } }
function saveInv(){ try{ localStorage.setItem(INV_KEY, JSON.stringify(inventory)); }catch(e){} }
var inventory = loadInv();

function escAttr(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function invKindBadge(k){
  if(k==="新刊") return '<span class="ir-kind k1">新刊</span>';
  if(k==="既刊") return '<span class="ir-kind k2">既刊</span>';
  if(k==="委託") return '<span class="ir-kind k3">委託</span>';
  return "";
}

/* 登録フォーム */
var invNewKind = "新刊";
function setInvKind(k){
  invNewKind = k;
  var seg = $("invKindSeg"); if(!seg) return;
  Array.prototype.forEach.call(seg.querySelectorAll("[data-k]"), function(b){ b.classList.toggle("on", b.dataset.k===k); });
}
$("invKindSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-k]"); if(!b) return; setInvKind(b.dataset.k);
});
$("invAddBtn").addEventListener("click", function(){
  var title = $("invTitle").value.trim();
  if(!title){ toast("タイトルを入力してください"); return; }
  var price = Math.max(0, Math.round(Number($("invPrice").value)||0));
  var sr = $("invStock").value.trim();
  var stock = sr==="" ? null : Math.max(0, Math.round(Number(sr)||0));
  inventory.push({ id:uid(), title:title, price:price, stock:stock, kind:invNewKind,
                   date:$("invDate").value, event:$("invEvent").value.trim(), createdAt:Date.now() });
  saveInv();
  $("invTitle").value=""; $("invPrice").value=""; $("invStock").value=""; $("invEvent").value=""; setInvKind("新刊");
  renderInventory(); toast("在庫に追加しました");
});

function renderInventory(){
  var host = $("invList");
  var q = invQuery.trim().toLowerCase();
  var rows = inventory.filter(function(it){
    if(invFilterKind && it.kind !== invFilterKind) return false;
    if(q) return ((it.title||"")+" "+(it.event||"")).toLowerCase().indexOf(q) >= 0;
    return true;
  }).slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||"") || (b.createdAt||0)-(a.createdAt||0); });
  if(!rows.length){
    host.innerHTML = '<div class="empty">'+(inventory.length ? "条件に合う頒布物がありません。" : "まだ頒布物が登録されていません。上のフォームから登録してください。")+'</div>';
    return;
  }
  host.innerHTML = rows.map(function(it){
    var stockTxt = it.stock===null ? "在庫管理なし" : ("在庫 "+ it.stock);
    var meta = [];
    if(it.date) meta.push('<span class="num">'+esc(it.date)+'</span>');
    if(it.event) meta.push('<span>'+esc(it.event)+'</span>');
    meta.push('<span class="ir-price num">'+yen(it.price)+'</span>');
    meta.push('<span class="num">'+esc(stockTxt)+'</span>');
    return '<div class="invrow" data-id="'+it.id+'">'+
      '<div class="ir-top"><span class="ir-title">'+esc(it.title)+'</span>'+invKindBadge(it.kind)+'</div>'+
      '<div class="ir-sub">'+ meta.join("") +'</div></div>';
  }).join("");
}
$("invSearch").addEventListener("input", function(){ invQuery = this.value; renderInventory(); });
$("invKindFilter").addEventListener("click", function(e){
  var b = e.target.closest("[data-kf]"); if(!b) return;
  invFilterKind = b.dataset.kf;
  Array.prototype.forEach.call(this.querySelectorAll("[data-kf]"), function(x){ x.classList.toggle("on", x.dataset.kf===invFilterKind); });
  renderInventory();
});

/* 頒布物カードを長押しで編集/削除 */
var invPressTimer=null, invSuppress=false, invStartY=0;
function openInvEdit(it){
  sheet("頒布物を編集",
    '<div class="inv-edit">'+
      '<div class="field"><label>タイトル</label><input id="eTitle" type="text" value="'+escAttr(it.title)+'"></div>'+
      '<div class="row2">'+
        '<div class="field"><label>単価（円）</label><input id="ePrice" type="number" inputmode="numeric" value="'+it.price+'"></div>'+
        '<div class="field"><label>在庫数</label><input id="eStock" type="number" inputmode="numeric" placeholder="未入力可" value="'+(it.stock===null?"":it.stock)+'"></div>'+
      '</div>'+
      '<div class="field"><label>種類</label><div class="segbtns" id="eKindSeg">'+
        ['新刊','既刊','委託'].map(function(k){ return '<button type="button" class="seg'+(it.kind===k?' on':'')+'" data-k="'+k+'">'+k+'</button>'; }).join("")+
      '</div></div>'+
      '<div class="row2">'+
        '<div class="field"><label>日付</label><input id="eDate" type="date" value="'+escAttr(it.date||"")+'"></div>'+
        '<div class="field"><label>イベント名</label><input id="eEvent" type="text" value="'+escAttr(it.event||"")+'"></div>'+
      '</div>'+
      '<button class="btn btn-primary" id="eSave">保存する</button>'+
      '<div style="height:10px"></div>'+
      '<button class="btn btn-danger" id="eDel">この頒布物を削除</button>'+
    '</div>');
  var ek = it.kind;
  $("eKindSeg").addEventListener("click", function(e){
    var b=e.target.closest("[data-k]"); if(!b) return; ek=b.dataset.k;
    Array.prototype.forEach.call(this.querySelectorAll("[data-k]"), function(x){ x.classList.toggle("on", x.dataset.k===ek); });
  });
  $("eSave").addEventListener("click", function(){
    var t=$("eTitle").value.trim(); if(!t){ toast("タイトルを入力してください"); return; }
    var sr=$("eStock").value.trim();
    it.title=t; it.price=Math.max(0,Math.round(Number($("ePrice").value)||0));
    it.stock = sr==="" ? null : Math.max(0, Math.round(Number(sr)||0));
    it.kind=ek; it.date=$("eDate").value; it.event=$("eEvent").value.trim();
    saveInv(); $("menuRoot").innerHTML=""; renderInventory(); toast("保存しました");
  });
  $("eDel").addEventListener("click", function(){
    confirmDialog({ title:"削除しますか？", body:"「"+esc(it.title)+"」を在庫から削除します。この操作は取り消せません。",
      ok:"削除する", danger:true, onOk:function(){
        inventory = inventory.filter(function(x){ return x.id!==it.id; });
        saveInv(); $("menuRoot").innerHTML=""; renderInventory(); toast("削除しました");
      }});
  });
}
function invPressStart(e){
  var card = e.target.closest(".invrow[data-id]"); if(!card) return;
  invStartY = e.touches ? e.touches[0].clientY : e.clientY;
  invSuppress = false;
  invPressTimer = setTimeout(function(){
    invPressTimer=null; invSuppress=true;
    if(navigator.vibrate){ try{ navigator.vibrate(18); }catch(err){} }
    var it = inventory.find(function(x){ return x.id===card.dataset.id; });
    if(it) openInvEdit(it);
    setTimeout(function(){ invSuppress=false; }, 700);
  }, 500);
}
function invPressEnd(){ clearTimeout(invPressTimer); invPressTimer=null; }
function invPressMove(e){ var y=e.touches?e.touches[0].clientY:e.clientY; if(Math.abs(y-invStartY)>10) invPressEnd(); }
(function(){
  var il=$("invList");
  il.addEventListener("touchstart", invPressStart, {passive:true});
  il.addEventListener("touchmove", invPressMove, {passive:true});
  il.addEventListener("touchend", invPressEnd);
  il.addEventListener("touchcancel", invPressEnd);
  il.addEventListener("mousedown", invPressStart);
  il.addEventListener("mousemove", invPressMove);
  il.addEventListener("mouseup", invPressEnd);
  il.addEventListener("mouseleave", invPressEnd);
  il.addEventListener("contextmenu", function(e){ e.preventDefault(); });
})();

/* ============ CSV出力 ============ */
function csvCell(v){
  v = (v===null||v===undefined) ? "" : String(v);
  if(/[",\n]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"';
  return v;
}
async function buildCSV(){
  var sessions = await allSessions();
  var head = ["日付","ファイル名","商品名","種類","単価","在庫数","販売数","小計","状態"];
  var lines = [head.join(",")];
  sessions.forEach(function(s){
    (s.items||[]).forEach(function(it){
      lines.push([
        csvCell(s.date), csvCell(s.name), csvCell(it.name), csvCell(it.kind||""),
        csvCell(it.price), csvCell(typeof it.stock==="number"?it.stock:""),
        csvCell(it.qty), csvCell(it.price*it.qty), csvCell(s.locked?"確定":"作成中")
      ].join(","));
    });
  });
  return lines.join("\r\n");
}
function stamp(){ var d=new Date(),p=function(x){return String(x).padStart(2,"0");};
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+"-"+p(d.getHours())+p(d.getMinutes()); }
$("csvAllBtn").addEventListener("click", async function(){
  var csv = await buildCSV();
  if(csv.split("\r\n").length<=1){ toast("出力するデータがありません"); return; }
  var bom = "\ufeff"; // Excelで文字化けしないBOM
  var ok=false;
  try{
    var blob = new Blob([bom+csv], {type:"text/csv;charset=utf-8"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href=url; a.download="uriage-"+stamp()+".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); },4000); ok=true;
  }catch(e){ ok=false; }
  toast(ok ? "CSVを書き出しました" : "書き出せませんでした。コピーをお使いください");
});
$("csvCopyBtn").addEventListener("click", async function(){
  var csv = await buildCSV();
  if(csv.split("\r\n").length<=1){ toast("出力するデータがありません"); return; }
  copyText(csv);
});
function copyText(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ toast("コピーしました"); }, function(){ legacyCopy(text); });
  } else legacyCopy(text);
}
function legacyCopy(text){
  var ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
  document.body.appendChild(ta); ta.select();
  var ok=false; try{ ok=document.execCommand("copy"); }catch(e){}
  document.body.removeChild(ta); toast(ok?"コピーしました":"コピーできませんでした");
}

/* ============ バックアップ / 引き継ぎ ============ */
async function collectBackup(){
  var folders = await allSessions();
  return { app:"uriage-tool", ver:1, exportedAt:Date.now(), folders:folders };
}
$("bkExportBtn").addEventListener("click", async function(){
  var data = await collectBackup();
  if(!data.folders.length){ toast("書き出すデータがありません"); return; }
  var json = JSON.stringify(data), ok=false;
  try{
    var blob=new Blob([json],{type:"application/json"}); var url=URL.createObjectURL(blob);
    var a=document.createElement("a"); a.href=url; a.download="uriage-backup-"+stamp()+".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); },4000); ok=true;
  }catch(e){}
  toast(ok?"バックアップを書き出しました":"書き出せませんでした。コピーをお使いください");
});
$("bkExportCopyBtn").addEventListener("click", async function(){
  var data = await collectBackup();
  if(!data.folders.length){ toast("書き出すデータがありません"); return; }
  copyText(JSON.stringify(data));
});
var bkFileInput = document.createElement("input");
bkFileInput.type="file"; bkFileInput.accept="application/json,.json"; bkFileInput.style.display="none";
document.body.appendChild(bkFileInput);
bkFileInput.addEventListener("change", function(){
  var f = bkFileInput.files && bkFileInput.files[0]; if(!f) return;
  var reader=new FileReader();
  reader.onload=function(){ parseImport(String(reader.result||"")); };
  reader.onerror=function(){ toast("fileを読み込めませんでした"); };
  reader.readAsText(f);
});
$("bkImportBtn").addEventListener("click", function(){ bkFileInput.value=""; bkFileInput.click(); });
$("bkPasteBtn").addEventListener("click", function(){
  var v = $("bkPasteArea").value.trim();
  if(!v){ toast("データが空です"); return; }
  parseImport(v);
});
function parseImport(text){
  var data; try{ data=JSON.parse(text); }catch(e){ toast("データを読み取れませんでした"); return; }
  if(!data || data.app!=="uriage-tool" || !Array.isArray(data.folders)){ toast("対応していないデータです"); return; }
  confirmDialog({
    title:"バックアップを読み込みますか？",
    body:data.folders.length+"件のファイルが見つかりました。今の記録に追加します（同じファイルは新しい内容で更新されます）。",
    ok:"読み込む",
    onOk:async function(){ await applyImport(data,"merge"); }
  });
}
async function applyImport(data, mode){
  if(mode==="replace"){ for(var i=0;i<index.length;i++){ await sdel(KEY(index[i].id)); } index=[]; }
  var added=0;
  for(var j=0;j<data.folders.length;j++){
    var f=data.folders[j]; if(!f||!f.id) continue;
    await sset(KEY(f.id), f);
    var row={ id:f.id, name:f.name, date:f.date, total:total(f), locked:!!f.locked, createdAt:f.createdAt||Date.now() };
    var pos=index.findIndex(function(x){ return x.id===f.id; });
    if(pos>=0) index[pos]=row; else { index.push(row); added++; }
  }
  await sset(IDX, index);
  renderHome();
  if(curView==="inventory") renderInventory();
  toast(added>0?(added+"件を追加しました"):"記録を更新しました");
}

/* ============ 外部出力（sale-sync.pages.dev 連携） ============ */
var EXT_KEY = "sales:extOn";
var extOn = false;
try{ extOn = JSON.parse(localStorage.getItem(EXT_KEY)||"false"); }catch(e){}
/* 外部ディスプレイの表示設定（スライドショー・お知らせ）。draft=編集中、live=表示中 */
var EXT_DISP_KEY = "sales:extDisplay";
var extDisp = { slideOn:true, slideSec:6, draft:{ text:"サークル主離席中", color:"#FFFFFF", bg:"#201830", size:18 }, live:null };
try{
  var _ed = JSON.parse(localStorage.getItem(EXT_DISP_KEY)||"null");
  if(_ed){
    if(typeof _ed.slideOn === "boolean") extDisp.slideOn = _ed.slideOn;
    if(_ed.slideSec) extDisp.slideSec = Math.max(2, Math.min(120, Math.round(Number(_ed.slideSec))||6));
    if(_ed.draft) for(var _k in extDisp.draft){ if(_ed.draft[_k] != null) extDisp.draft[_k] = _ed.draft[_k]; }
    if(_ed.live && _ed.live.text) extDisp.live = _ed.live;
  }
}catch(e){}
var SS = window.SalesSync || null;

function extActive(){ return !!(SS && SS.isActive && SS.isActive()); }
/* 今の会計 = 累計 − 前回「会計完了」時点の累計（差分）。手元の累計表示は崩さない。 */
function updateCheckoutBtn(){
  var btn = $("checkoutBtn"); if(!btn) return;
  // 計算中（未確定）のファイルを開いている間は常に表示（外部出力ON/OFFに関わらずレジ方式）
  btn.classList.toggle("hidden", !(sess && !sess.locked));
}
function currentCheckout(){
  var base = (sess && sess.checkoutBase) || {};
  var items = [], total = 0;
  (sess ? (sess.items||[]) : []).forEach(function(it){
    var d = it.qty - (base[it.id]||0);
    if(d > 0){ items.push({ name:it.name, price:it.price, qty:d, kind:it.kind||"" }); total += it.price * d; }
  });
  return { items:items, total:total };
}
function extPayload(){
  var p;
  if(!sess) p = { title:"", items:[], total:0 };
  else {
    var c = currentCheckout();
    p = { title: sess.name + (sess.date ? "　" + sess.date : ""), total: c.total, items: c.items };
  }
  p.slide = slidePayload();
  p.notice = extDisp.live && extDisp.live.text
    ? { on:true, text:extDisp.live.text, color:extDisp.live.color, bg:extDisp.live.bg, size:extDisp.live.size }
    : { on:false };
  return p;
}
function extPush(){
  if(extOn && SS && extActive()){
    try{ SS.update(extPayload()); }catch(e){}
    if(typeof syncSlides === "function") syncSlides();
  }
}

/* 会計完了：今の会計分を1件記録し、次の会計へ（外部表示は¥0に戻る）。累計・販売数は保持。 */
$("checkoutBtn").addEventListener("click", async function(){
  if(!sess || sess.locked) return;
  var c = currentCheckout();
  if(!c.total){ toast("この会計に商品がありません"); return; }
  if(!sess.checkoutBase) sess.checkoutBase = {};
  (sess.items||[]).forEach(function(it){ sess.checkoutBase[it.id] = it.qty; });
  if(!sess.checkouts) sess.checkouts = [];
  sess.checkouts.push({ amount:c.total, count:c.items.reduce(function(a,i){return a+i.qty;},0), ts:Date.now() });
  await persist();
  renderItems(); renderTotal();   // 今の会計→0、売上に加算、カードは×0に戻る
  extPush(); // 差分0になり外部ディスプレイは¥0にリセット
  toast("会計完了：¥" + c.total.toLocaleString("ja-JP") + "（売上に加算）");
});

function refreshExtUI(){
  var tg=$("extToggle"), panel=$("extPanel"), sub=$("extStateSub"), st=$("extStatus");
  if(!tg) return;
  tg.classList.toggle("on", extOn);
  tg.setAttribute("aria-checked", extOn?"true":"false");
  sub.textContent = extOn ? "ON（外部ディスプレイに反映）" : "OFF（単独動作）";
  panel.classList.toggle("hidden", !extOn);
  $("pinInput").value = $("pinInput").value || "";
  if(extOn){
    if(extActive()){ st.className="ext-status on"; st.textContent="接続中（同期しています）"; }
    else { st.className="ext-status"; st.textContent="未接続：QR読み取りか8桁PINで接続してください"; }
  }
  if($("ntLive") && typeof NT_COLORS !== "undefined"){ try{ refreshNoticeUI(); }catch(e){} }
  if(typeof renderSlideSync === "function"){ try{ renderSlideSync(); }catch(e){} }
}
$("extToggle").addEventListener("click", function(){
  extOn = !extOn;
  try{ localStorage.setItem(EXT_KEY, JSON.stringify(extOn)); }catch(e){}
  refreshExtUI();
  updateCheckoutBtn();
  if(extOn) extPush();
  toast(extOn ? "外部出力をONにしました" : "外部出力をOFFにしました");
});

async function connectPin(pin){
  pin = (pin||"").replace(/\D/g,"");
  if(pin.length !== 8){ toast("8桁のPINを入力してください"); return; }
  if(!SS){ toast("同期モジュールを読み込めていません（通信環境をご確認ください）"); return; }
  toast("接続中…");
  var ok=false;
  try{ ok = await SS.connectWithPin(pin); }catch(e){ ok=false; }
  if(ok){
    if(!extOn){ extOn=true; try{ localStorage.setItem(EXT_KEY, JSON.stringify(true)); }catch(e){} }
    refreshExtUI(); extPush(); toast("接続しました");
  } else { refreshExtUI(); toast("接続できませんでした。PINが正しいか・期限内かご確認ください"); }
}
$("pinConnectBtn").addEventListener("click", function(){ connectPin($("pinInput").value); });
$("pinInput").addEventListener("keydown", function(e){ if(e.key==="Enter") connectPin($("pinInput").value); });

/* QRコード読み取り（カメラ／BarcodeDetector） */
$("qrScanBtn").addEventListener("click", startQR);
function startQR(){
  if(!("BarcodeDetector" in window)){
    toast("この端末はQR自動読み取りに未対応です。PINを直接入力してください");
    return;
  }
  var root=$("qrRoot");
  root.innerHTML =
    '<div class="qr-wrap"><div class="qr-head"><h3>QRコードを読み取り</h3>'+
    '<button class="qr-close" id="qrClose" aria-label="閉じる">✕</button></div>'+
    '<div class="qr-video-wrap"><video id="qrVideo" playsinline muted></video><div class="qr-frame"></div></div>'+
    '<div class="qr-hint">外部ディスプレイに表示されたPINのQRコードを枠に合わせてください</div></div>';
  var video=$("qrVideo"), stream=null, det=null, raf=null, stopped=false;
  function stop(){
    stopped=true; if(raf) cancelAnimationFrame(raf);
    try{ if(stream) stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
    root.innerHTML="";
  }
  $("qrClose").addEventListener("click", stop);
  (async function(){
    try{
      det = new window.BarcodeDetector({ formats:["qr_code"] });
      stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" } });
      video.srcObject = stream; await video.play();
    }catch(e){ toast("カメラを起動できませんでした"); stop(); return; }
    async function scan(){
      if(stopped) return;
      try{
        var codes = await det.detect(video);
        if(codes && codes.length){
          var pin = String(codes[0].rawValue||"").replace(/\D/g,"").slice(0,8);
          if(navigator.vibrate){ try{ navigator.vibrate(20); }catch(e){} }
          stop();
          if(pin.length===8) connectPin(pin); else toast("PINを読み取れませんでした");
          return;
        }
      }catch(e){}
      raf = requestAnimationFrame(scan);
    }
    scan();
  })();
}

/* ============ 外部ディスプレイ：待機スライドショー／お知らせ表示 ============ */
var NT_COLORS = ["#FFFFFF","#F6C56B","#FF6B6B","#7FD4FF","#6FE0B0","#FFB3D1","#111111"];
var NT_BGS    = ["#201830","#000000","#FFFFFF","#7A1F2B","#0C1730","#0F3D2E","#F6C56B"];
function extDispSave(){ try{ localStorage.setItem(EXT_DISP_KEY, JSON.stringify(extDisp)); }catch(e){} }
function clampSec(v){ v = Math.round(Number(v)); if(!isFinite(v)) v = 6; return Math.max(2, Math.min(120, v)); }

/* 文字を枠に収める：大きさ(%)＝枠の高さに対する割合。はみ出す時だけ自動で縮小 */
function fitNotice(box, el, sizePct){
  var h = box.clientHeight; if(!h) return;
  var fs = h * sizePct / 100;
  el.style.fontSize = fs + "px";
  for(var i=0; i<40 && (box.scrollHeight > box.clientHeight + 1 || el.scrollWidth > box.clientWidth + 1); i++){
    fs *= 0.93; el.style.fontSize = fs + "px";
  }
}
function paintPreview(box, textEl, d){
  box.style.background = d.bg; box.style.color = d.color;
  textEl.textContent = d.text || "（文字を入力してください）";
  textEl.style.opacity = d.text ? "1" : ".45";
  fitNotice(box, textEl, d.size);
}
function renderSwatches(rootId, list, cur, key){
  var root = $(rootId);
  var inList = list.some(function(c){ return c.toLowerCase() === String(cur).toLowerCase(); });
  root.innerHTML = list.map(function(c){
    return '<button type="button" class="sw'+(c.toLowerCase()===String(cur).toLowerCase()?' on':'')+'" data-c="'+c+'" style="background:'+c+'" aria-label="'+c+'"></button>';
  }).join("") +
  '<label class="sw-custom'+(inList?'':' on')+'" style="'+(inList?'':'background:'+cur)+'" title="自由に選ぶ">'+
    (inList?'<span class="plus">＋</span>':'')+
    '<input type="color" data-k="'+key+'" value="'+(/^#[0-9a-f]{6}$/i.test(cur)?cur:"#ffffff")+'"></label>';
}
function refreshNoticeUI(){
  var d = extDisp.draft;
  if($("ntText").value !== d.text) $("ntText").value = d.text;
  renderSwatches("ntColorSw", NT_COLORS, d.color, "color");
  renderSwatches("ntBgSw", NT_BGS, d.bg, "bg");
  $("ntSize").value = d.size; $("ntSizeVal").textContent = d.size;
  paintPreview($("ntPreview"), $("ntPreviewText"), d);
  var live = $("ntLive");
  if(extDisp.live && extDisp.live.text){
    live.className = "nt-live on";
    live.textContent = "表示中：「" + extDisp.live.text.replace(/\n/g," ") + "」" + (extActive() ? "" : "（接続後に表示されます）");
  } else { live.className = "nt-live"; live.textContent = "外部ディスプレイ：表示していません"; }
  $("ntHideBtn").classList.toggle("hidden", !(extDisp.live && extDisp.live.text));
}
function refreshSlideUI(){
  var tg = $("slideToggle");
  tg.classList.toggle("on", !!extDisp.slideOn);
  tg.setAttribute("aria-checked", extDisp.slideOn ? "true" : "false");
  $("slideSub").textContent = extDisp.slideOn ? "ON（待機中は画像を表示）" : "OFF（待機中も計算画面のまま）";
  $("slideSecVal").textContent = extDisp.slideSec + "秒";
  $("slideSecBtns").querySelectorAll("[data-sec]").forEach(function(b){
    b.classList.toggle("on", Number(b.dataset.sec) === extDisp.slideSec);
  });
  if(document.activeElement !== $("slideSecInput")) $("slideSecInput").value = extDisp.slideSec;
}
function extDispChanged(){ extDispSave(); extPush(); }

$("slideToggle").addEventListener("click", function(){
  extDisp.slideOn = !extDisp.slideOn; refreshSlideUI(); extDispChanged();
  toast(extDisp.slideOn ? "待機スライドショーをONにしました" : "待機スライドショーをOFFにしました");
});
$("slideSecBtns").addEventListener("click", function(e){
  var b = e.target.closest("[data-sec]"); if(!b) return;
  extDisp.slideSec = clampSec(b.dataset.sec); refreshSlideUI(); extDispChanged();
});
$("slideSecInput").addEventListener("change", function(){
  extDisp.slideSec = clampSec(this.value); this.value = extDisp.slideSec;
  refreshSlideUI(); extDispChanged(); toast("表示時間を" + extDisp.slideSec + "秒にしました");
});

$("ntText").addEventListener("input", function(){
  extDisp.draft.text = this.value; extDispSave();
  paintPreview($("ntPreview"), $("ntPreviewText"), extDisp.draft);
});
$("ntPresets").addEventListener("click", function(e){
  var b = e.target.closest(".chip"); if(!b) return;
  extDisp.draft.text = b.textContent; extDispSave(); refreshNoticeUI();
});
function onSwatch(e){
  var b = e.target.closest(".sw"); if(!b) return;
  var key = this.id === "ntColorSw" ? "color" : "bg";
  extDisp.draft[key] = b.dataset.c; extDispSave(); refreshNoticeUI();
}
function onCustomColor(e){
  if(!e.target.matches('input[type="color"]')) return;
  extDisp.draft[e.target.dataset.k] = e.target.value; extDispSave();
  if(e.type === "change") refreshNoticeUI();
  else paintPreview($("ntPreview"), $("ntPreviewText"), extDisp.draft);
}
["ntColorSw","ntBgSw"].forEach(function(id){
  $(id).addEventListener("click", onSwatch);
  $(id).addEventListener("input", onCustomColor);
  $(id).addEventListener("change", onCustomColor);
});
$("ntSize").addEventListener("input", function(){
  extDisp.draft.size = Number(this.value); $("ntSizeVal").textContent = this.value; extDispSave();
  paintPreview($("ntPreview"), $("ntPreviewText"), extDisp.draft);
});
window.addEventListener("resize", function(){ paintPreview($("ntPreview"), $("ntPreviewText"), extDisp.draft); });

/* 表示する：確認ダイアログでプレビュー → OKで外部ディスプレイへ */
$("ntShowBtn").addEventListener("click", function(){
  var d = extDisp.draft;
  if(!String(d.text||"").trim()){ toast("表示する文字を入力してください"); return; }
  confirmDialog({
    title: "お知らせを表示しますか？",
    body: extActive() ? "外部ディスプレイの全面にこの内容を表示します。解除するまで計算画面より優先されます。"
                      : "まだ外部ディスプレイに接続していません。接続するとこの内容で表示されます。",
    recap: '<div class="nt-preview" id="ntDlgPreview"><div class="nt-text" id="ntDlgText"></div></div>',
    ok: "OK・表示する",
    onOk: function(){
      extDisp.live = { text:d.text, color:d.color, bg:d.bg, size:d.size };
      extDispChanged(); refreshNoticeUI();
      toast(extActive() ? "お知らせを表示しました" : "接続後に表示されます");
    }
  });
  requestAnimationFrame(function(){ var b=$("ntDlgPreview"); if(b) paintPreview(b, $("ntDlgText"), d); });
});
$("ntHideBtn").addEventListener("click", function(){
  extDisp.live = null; extDispChanged(); refreshNoticeUI();
  toast("お知らせ表示を解除しました");
});

/* ---------- スライドショー画像（この端末のIndexedDBに保存 → 外部ディスプレイへ送信） ---------- */
var SLIDE_MAX = 20;                         // サーバー側の上限と同じ
var SLIDE_SENT_KEY = "sales:slideSent";     // どのセッションにどの版を送ったか
var slideImgs = [];                         // [{id, data}]
var slideVer = "";
var slideSent = null; try{ slideSent = JSON.parse(localStorage.getItem(SLIDE_SENT_KEY)||"null"); }catch(e){}
var slideBusy = false, slideErr = "";

function sidb(){
  return new Promise(function(res, rej){
    var r = indexedDB.open("sales-slides", 1);
    r.onupgradeneeded = function(){ r.result.createObjectStore("kv"); };
    r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ rej(r.error); };
  });
}
function sidbGet(k){ return sidb().then(function(db){ return new Promise(function(res,rej){
  var q = db.transaction("kv","readonly").objectStore("kv").get(k); q.onsuccess=function(){ res(q.result||null); }; q.onerror=function(){ rej(q.error); }; }); }); }
function sidbSet(k,v){ return sidb().then(function(db){ return new Promise(function(res,rej){
  var t = db.transaction("kv","readwrite"); t.objectStore("kv").put(v,k); t.oncomplete=function(){ res(); }; t.onerror=function(){ rej(t.error); }; }); }); }

function slideSentOk(){
  var sid = SS && SS.sessionId ? SS.sessionId() : null;
  return !!(sid && slideSent && slideSent.sid === sid && slideSent.ver === slideVer);
}
function slidePayload(){
  var ok = slideSentOk();
  return { on: !!extDisp.slideOn, sec: extDisp.slideSec, ver: ok ? slideVer : "", count: ok ? slideImgs.length : 0 };
}
async function saveSlides(){
  slideVer = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  try{ await sidbSet("slides", { ver:slideVer, list:slideImgs }); }catch(e){ toast("画像を保存できませんでした（容量不足の可能性）"); }
  renderSlides(); syncSlides();
}
function downscaleSlide(file){
  return new Promise(function(res, rej){
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function(){
      var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, 1600 / Math.max(w, h));
      w = Math.round(w*sc); h = Math.round(h*sc);
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0,0,w,h); g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error("load")); };
    img.src = url;
  });
}
function renderSlides(){
  var g = $("slideGrid"); if(!g) return;
  $("slideCount").textContent = slideImgs.length + "/" + SLIDE_MAX;
  if(!slideImgs.length){ g.innerHTML = '<div class="sl-empty">画像がありません。「画像を追加」から選んでください</div>'; }
  else g.innerHTML = slideImgs.map(function(s, i){
    return '<div class="sl-item"><img src="'+s.data+'" alt=""><span class="no">'+(i+1)+'</span>'+
      '<button type="button" class="rm" data-rm="'+i+'" aria-label="削除">✕</button>'+
      '<div class="mv"><button type="button" data-mv="'+i+'" data-d="-1" aria-label="前へ"'+(i===0?' disabled':'')+'>‹</button>'+
      '<button type="button" data-mv="'+i+'" data-d="1" aria-label="後ろへ"'+(i===slideImgs.length-1?' disabled':'')+'>›</button></div></div>';
  }).join("");
  $("slideAddBtn").classList.toggle("hidden", slideImgs.length >= SLIDE_MAX);
  renderSlideSync();
}
function renderSlideSync(){
  var el = $("slideSync"); if(!el) return;
  if(!slideImgs.length){ el.className = "nt-live"; el.textContent = "画像は未登録です（外部ディスプレイ側で登録した画像があればそちらを表示）"; return; }
  if(!extOn || !extActive()){ el.className = "nt-live"; el.textContent = slideImgs.length + "枚：外部ディスプレイに接続すると自動で送信します"; return; }
  if(slideBusy){ el.className = "nt-live"; el.textContent = "外部ディスプレイへ送信中…"; return; }
  if(slideErr){ el.className = "nt-live err"; el.textContent = slideErr; return; }
  if(slideSentOk()){ el.className = "nt-live ok"; el.textContent = slideImgs.length + "枚を外部ディスプレイに送信済み"; return; }
  el.className = "nt-live"; el.textContent = "送信待ち…";
}
async function syncSlides(){
  if(!extOn || !SS || !SS.pushMedia || !extActive()) { renderSlideSync(); return; }
  if(slideBusy || slideSentOk()) { renderSlideSync(); return; }
  var sid = SS.sessionId(), ver = slideVer;
  slideBusy = true; slideErr = ""; renderSlideSync();
  var r = await SS.pushMedia(slideImgs.map(function(s){ return s.data; }), ver);
  slideBusy = false;
  if(r && r.ok){
    slideSent = { sid:sid, ver:ver };
    try{ localStorage.setItem(SLIDE_SENT_KEY, JSON.stringify(slideSent)); }catch(e){}
    try{ SS.update(extPayload()); }catch(e){}       // 新しい版番号を外部ディスプレイへ知らせる
    if(ver !== slideVer) return syncSlides();       // 送信中に変更があれば続けて送る
  }else{
    slideErr = (r && r.message) ? "送信できませんでした：" + r.message : "送信できませんでした。通信状況を確認してください（タップで再送）";
  }
  renderSlideSync();
}
$("slideSync").addEventListener("click", function(){ if(slideErr){ slideErr = ""; syncSlides(); } });
$("slideAddBtn").addEventListener("click", function(){ $("slideFile").click(); });
$("slideFile").addEventListener("change", async function(e){
  var files = Array.prototype.slice.call(e.target.files || []); e.target.value = "";
  if(!files.length) return;
  var room = SLIDE_MAX - slideImgs.length;
  if(room <= 0){ toast("画像は最大" + SLIDE_MAX + "枚までです"); return; }
  toast("画像を読み込み中…");
  var added = 0;
  for(var i=0; i<files.length && added<room; i++){
    try{ slideImgs.push({ id:uid(), data: await downscaleSlide(files[i]) }); added++; }catch(err){}
  }
  await saveSlides();
  toast(added + "枚追加しました" + (files.length > room ? "（上限" + SLIDE_MAX + "枚のため一部は追加していません）" : ""));
});
$("slideGrid").addEventListener("click", function(e){
  var rm = e.target.closest("[data-rm]"), mv = e.target.closest("[data-mv]");
  if(rm){
    var i = Number(rm.dataset.rm);
    confirmDialog({ title:"この画像を削除しますか？", body:(i+1) + "枚目の画像をスライドショーから外します。",
      ok:"削除する", danger:true, onOk:function(){ slideImgs.splice(i,1); saveSlides(); toast("削除しました"); } });
  }else if(mv && !mv.disabled){
    var a = Number(mv.dataset.mv), b = a + Number(mv.dataset.d);
    if(b < 0 || b >= slideImgs.length) return;
    var t = slideImgs[a]; slideImgs[a] = slideImgs[b]; slideImgs[b] = t;
    saveSlides();
  }
});
sidbGet("slides").then(function(v){
  if(v && Array.isArray(v.list)){ slideImgs = v.list; slideVer = v.ver || ""; }
  renderSlides(); extPush();
}).catch(function(){ renderSlides(); });

/* ユーティリティを開いた時にプレビューを描き直す（非表示中はサイズが0のため） */
document.querySelectorAll('.tab[data-view="utility"]').forEach(function(t){
  t.addEventListener("click", function(){ requestAnimationFrame(function(){ refreshNoticeUI(); refreshSlideUI(); }); });
});
refreshSlideUI(); refreshNoticeUI();

/* 外部出力の起動：ONで、保存済みセッションが有効ならそのまま同期継続 */
refreshExtUI();
if(extOn) extPush();

document.body.classList.add("has-tabbar");
showView("inventory");

loadIndex();
})();
