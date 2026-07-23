const STORAGE_KEY = 'uriage-keisan-data';

const els = {
  folderName: document.getElementById('folderName'),
  recordDate: document.getElementById('recordDate'),
  productName: document.getElementById('productName'),
  productPrice: document.getElementById('productPrice'),
  btnPlus: document.getElementById('btnPlus'),
  btnMinus: document.getElementById('btnMinus'),
  btnReset: document.getElementById('btnReset'),
  btnFinish: document.getElementById('btnFinish'),
  btnRefresh: document.getElementById('btnRefresh'),
  runningTotal: document.getElementById('runningTotal'),
  operationList: document.getElementById('operationList'),
  savedRecords: document.getElementById('savedRecords'),
  folderList: document.getElementById('folderList'),
  toast: document.getElementById('toast'),
};

let runningTotal = 0;
let operations = [];

function formatYen(amount) {
  return '¥' + amount.toLocaleString('ja-JP');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { folders: {} };
  } catch {
    return { folders: {} };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getFolderNames(data) {
  return Object.keys(data.folders).sort();
}

function updateFolderDatalist() {
  const data = loadData();
  const names = getFolderNames(data);
  els.folderList.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">`).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateTotalDisplay() {
  els.runningTotal.textContent = formatYen(runningTotal);
}

function renderOperations() {
  if (operations.length === 0) {
    els.operationList.innerHTML =
      '<li class="empty-msg">＋または−ボタンを押すとここに表示されます</li>';
    return;
  }

  els.operationList.innerHTML = operations
    .map((op, i) => {
      const sign = op.type === '+' ? '＋' : '−';
      const cls = op.type === '+' ? 'op-plus' : 'op-minus';
      const name = op.productName ? `（${escapeHtml(op.productName)}）` : '';
      return `<li class="${cls}">${i + 1}. ${sign} ${formatYen(op.amount)}${name} → 合計 ${formatYen(op.totalAfter)}</li>`;
    })
    .join('');
}

function getPriceInput() {
  const val = els.productPrice.value.trim();
  if (val === '') return 0;
  const num = parseInt(val, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

function applyOperation(type) {
  const amount = getPriceInput();
  const productName = els.productName.value.trim();

  if (type === '+' || type === '-') {
    if (amount === 0 && !productName) {
      showToast('商品価格を入力してください');
      return;
    }
  }

  if (type === '+') {
    runningTotal += amount;
  } else {
    runningTotal -= amount;
  }

  operations.push({
    type,
    amount,
    productName,
    totalAfter: runningTotal,
    timestamp: new Date().toISOString(),
  });

  updateTotalDisplay();
  renderOperations();
}

function resetSession() {
  runningTotal = 0;
  operations = [];
  els.productName.value = '';
  els.productPrice.value = '';
  updateTotalDisplay();
  renderOperations();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function finishAndSave() {
  const folder = els.folderName.value.trim();
  const date = els.recordDate.value;

  if (!folder) {
    showToast('フォルダ名を入力してください');
    els.folderName.focus();
    return;
  }

  if (!date) {
    showToast('日付を選択してください');
    els.recordDate.focus();
    return;
  }

  if (operations.length === 0) {
    showToast('＋または−ボタンで操作してから保存してください');
    return;
  }

  const data = loadData();
  if (!data.folders[folder]) {
    data.folders[folder] = {};
  }
  if (!data.folders[folder][date]) {
    data.folders[folder][date] = [];
  }

  const record = {
    id: crypto.randomUUID(),
    productName: els.productName.value.trim() || '（未入力）',
    unitPrice: getPriceInput(),
    finalTotal: runningTotal,
    operations: [...operations],
    savedAt: new Date().toISOString(),
  };

  data.folders[folder][date].push(record);
  saveData(data);

  showToast(`「${folder}」/${date} に保存しました`);
  resetSession();
  updateFolderDatalist();
  renderSavedRecords();
}

function formatDateJa(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function renderSavedRecords() {
  const data = loadData();
  const folders = Object.keys(data.folders).sort();

  if (folders.length === 0) {
    els.savedRecords.innerHTML = '<p class="empty-msg">保存されたデータはありません</p>';
    return;
  }

  let html = '';
  for (const folder of folders) {
    const dates = Object.keys(data.folders[folder]).sort().reverse();
    html += `<div class="folder-group"><div class="folder-title">📁 ${escapeHtml(folder)}</div>`;

    for (const date of dates) {
      const records = data.folders[folder][date];
      if (records.length === 0) continue;

      html += `<div class="date-group"><div class="date-label">${formatDateJa(date)}</div>`;
      for (const rec of records) {
        const opCount = rec.operations.length;
        html += `
          <div class="record-item" data-id="${rec.id}" data-folder="${escapeHtml(folder)}" data-date="${date}">
            <div class="record-info">
              ${escapeHtml(rec.productName)}（操作 ${opCount} 回）
            </div>
            <span class="record-amount">${formatYen(rec.finalTotal)}</span>
            <button type="button" class="btn btn-delete" data-action="delete">削除</button>
          </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }

  els.savedRecords.innerHTML = html;
}

function deleteRecord(folder, date, id) {
  const data = loadData();
  if (!data.folders[folder]?.[date]) return;

  data.folders[folder][date] = data.folders[folder][date].filter((r) => r.id !== id);

  if (data.folders[folder][date].length === 0) {
    delete data.folders[folder][date];
  }
  if (Object.keys(data.folders[folder]).length === 0) {
    delete data.folders[folder];
  }

  saveData(data);
  updateFolderDatalist();
  renderSavedRecords();
  showToast('削除しました');
}

els.btnPlus.addEventListener('click', () => applyOperation('+'));
els.btnMinus.addEventListener('click', () => applyOperation('-'));
els.btnReset.addEventListener('click', () => {
  if (operations.length > 0 && !confirm('現在の計算内容をリセットしますか？')) return;
  resetSession();
});
els.btnFinish.addEventListener('click', finishAndSave);
els.btnRefresh.addEventListener('click', renderSavedRecords);

els.savedRecords.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn) return;

  const item = btn.closest('.record-item');
  const { id, folder, date } = item.dataset;
  if (confirm('この記録を削除しますか？')) {
    deleteRecord(folder, date, id);
  }
});

els.recordDate.value = todayISO();
updateTotalDisplay();
updateFolderDatalist();
renderSavedRecords();
