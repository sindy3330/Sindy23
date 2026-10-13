# 技術文件 — 蔡Sindy 房仲客戶管理系統

本文件說明系統的技術架構、資料模型與核心邏輯，供開發與維護參考。使用方式請見 [README.md](./README.md)。

---

## 1. 技術棧

| 層 | 技術 |
|----|------|
| 前端框架 | React 19 |
| 建置工具 | Vite 8 |
| 後端 | Supabase（PostgreSQL + PostgREST + Realtime） |
| 資料庫存取 | `@supabase/supabase-js` |
| 樣式 | 原生 CSS（每個元件一份 `.css`，無 CSS 框架） |
| Lint | ESLint 10 + react-hooks / react-refresh plugin |

**架構特性：純前端 SPA**。沒有自建後端伺服器，瀏覽器直接透過 `@supabase/supabase-js` 與 Supabase 溝通。驗證金鑰（anon key）透過 `VITE_` 前綴的環境變數注入。

---

## 2. 目錄結構

```
src/
├── main.jsx                      # 進入點，掛載 <App/>（StrictMode）
├── App.jsx                       # 根元件：全域狀態、所有 handler、四個分頁渲染
├── api.js                        # Supabase 存取層：CRUD、欄位映射、資料組裝、同步
├── utils/
│   └── date.js                   # nowDatetime()、toRocDate()、genId()
└── components/
    ├── TabBar.jsx                # 頂部四分頁切換
    ├── ClientRow.jsx             # 追蹤線：客戶列 + 物件子列 + 維護面板 + 新增物件表單
    ├── PropertyRow.jsx           # 客戶底下的物件子列（含該客戶專屬的帶看日/備註/業務紀錄）
    ├── BuyerRow.jsx              # 買方列
    ├── ClosedClientRow.jsx       # 成交客戶列
    ├── PropertyManagementRow.jsx # 物件管理列（物件主檔）
    ├── BusinessLogModal.jsx      # 業務紀錄彈窗
    ├── BuyerInfoModal.jsx        # 買方資料彈窗
    ├── PropertyInfoModal.jsx     # 物件明細彈窗
    ├── FilterBar.jsx             # ⚠️ 目前未使用（保留）
    └── WatchingPropertiesPanel.jsx # ⚠️ 目前未使用（保留）
```

> `FilterBar.jsx` 與 `WatchingPropertiesPanel.jsx` 未被任何檔案 import，屬於早期遺留元件，可視需要移除。

---

## 3. 資料模型

後端共六張表（詳見 [DB.md](./DB.md)）：

| 表 | 中文 | 說明 |
|----|------|------|
| `properties` | 物件 | 物件主檔 |
| `clients` | 客戶 | 追蹤線客戶 |
| `buyers` | 買方 | 買方名單 |
| `closed_clients` | 成交客戶 | 已成交紀錄 |
| `maintenance_logs` | 維護紀錄 | 屬於某客戶（FK `client_id`，ON DELETE CASCADE） |
| `business_logs` | 業務紀錄 | 屬於某客戶的某物件（FK `client_id`，CASCADE；另有 `property_no`） |

### 關聯設計

- **客戶 ↔ 物件**（多對多）：以 `clients.property_nos` 文字欄位（逗號分隔的物件編號）表示，非正規化。
- **買方 ↔ 物件**（多對多）：以 `buyers.watched_property_nos` 文字欄位表示。
- **客戶專屬的物件資料**：同一物件被不同客戶引用時，各自的「帶看日」「備註」存在 `clients.property_showing_dates` 與 `clients.property_notes` 兩個 **JSONB** 欄位中（key 為物件編號）。
- **客戶 ↔ 買方**：以**姓名**比對連結（`client.name === buyer.name`），**非外鍵**。原本的 `buyer_id` 欄位已移除。
  - 影響：同名會誤連、改名會斷連。屬已知取捨。

---

## 4. 資料存取層（`api.js`）

### 欄位命名映射
JS 端用 camelCase，DB 用 snake_case。透過 `SNAKE` 對照表與 `toSnake()` / `toCamel()` 雙向轉換。

### `loadAllData()`
平行 `select('*')` 六張表 → 交給 `assembleData()` 組裝成前端使用的巢狀結構。

### `assembleData(raw)`（核心組裝邏輯）
把扁平的資料表組成 UI 需要的形狀：

1. **物件主檔** `masterProps`：數字欄位轉型。
2. **維護紀錄** 依 `client_id` 分組。
3. **業務紀錄** 依 `client_id__property_no` 分組。
4. **客戶**：把 `property_nos` 拆開，對每個編號從 `masterProps` 找出物件，合併該客戶專屬的 `showingDate`（來自 JSONB）、`clientNotes`（來自 JSONB）、`businessLogs`。
5. **買方**：把 `watched_property_nos` 拆開組出 `watchingProperties`；帶看日從對應客戶的 JSONB 推得（`showingDateMap`，以 `買方姓名__物件編號` 為 key）。

### 同步函式

| 函式 | 行為 |
|------|------|
| `syncClient(updated, prev)` | 白名單寫入客戶欄位；從 `properties` 重建 `property_nos` 與兩個 JSONB；以 diff 偵測新增的維護/業務紀錄與物件 `saleType`/`updatedAt` 變更，分別寫入。`updatedAt` 採用 `updated.updatedAt ?? nowDatetime()`（見 §6 綠框/黃框）。 |
| `syncBuyer(updated)` | 重建 `watched_property_nos` 後整列更新。 |
| `syncClosedClient(updated)` | 整列更新。 |
| `syncProperty(prop)` | 剝除前端專屬欄位（`businessLogs`/`showingDate`/`clientNotes`）後更新物件主檔。 |

### Realtime
`subscribeToChanges()` 訂閱 `public` schema 所有變更，任一變更觸發 callback。App 端以 **400ms debounce** 包住，避免短時間多筆事件造成連續全表重抓。

---

## 5. 狀態管理與資料流（`App.jsx`）

採「**樂觀更新 + 即時訂閱對帳**」模式：

```
使用者操作
  → 立即更新本地 state（畫面瞬間反應）
  → 呼叫 sync* 寫入 Supabase
  → DB 變更觸發 Realtime
  → debounce 後 fetchAll → assembleData → 重新 setState（與後端對帳）
```

- 所有資料放在 App 的 `useState`：`clients` / `buyers` / `closedClients` / `properties`。
- `prevClientsRef`：保存上一版客戶，供 `syncClient` 做 diff。
- `buyersRef` / `propertiesRef`：避免 callback 閉包拿到舊值。

### 效能處理
- **`visibleClients`（useMemo）**：客戶的搜尋過濾 + 依 `updatedAt` 降序排序，只在 `clients` 或 `clientSearch` 改變時重算（不再每次 render 都排序）。
- **`buyersByName`（useMemo）**：一次建好 `Map<姓名, 買方>` 傳給各列，取代逐列 `find` 的 O(n×m)。
- **`genId()`**：`Date.now()*1000 + 計數器`，避免同毫秒新增主鍵碰撞。
- **`generatePropertyNo()`**：取同前綴的最大流水號 +1，避免重號。

---

## 6. 重要業務邏輯

### 綠框 / 黃框 的「最後修改日」獨立
- **綠框**＝客戶列本身（client-level）：改備註、下次計劃、追/募、新增維護紀錄/物件時，元件帶 `updatedAt: nowDatetime()`。
- **黃框**＝物件子列（property-level）：改帶看日、同業/自售、業務紀錄、子列備註時，只更新該物件的 `updatedAt`，**不動**客戶的。
- 關鍵：`ClientRow.handlePropertyUpdate` 傳遞物件變更時**不**附帶 client `updatedAt`；而 `syncClient` 改為信任傳入值（`updated.updatedAt ?? nowDatetime()`），不再強制覆寫，兩個時間才能真正獨立。

### 跨分頁的資料帶入（依姓名）
- **追蹤線客戶電話**：有同名買方時顯示買方電話。
- **成交客戶**：有同名買方時，電話/生日/戶籍地/通訊地一律顯示買方資料。
- 實作：App 建 `buyersByName` Map 傳給 `ClientRow` 與 `ClosedClientRow`。

### 物件主檔修改即時反映到客戶子列
`handleUpdateProperty` 在更新 `properties` 的同時，遍歷 `clients`，把引用該物件的子列同步成新的主檔資料，並**保留**各客戶專屬的 `showingDate`/`clientNotes`/`businessLogs`。如此不必等 Realtime 重抓即可即時更新。

### 編輯互動模式（三種）
1. **點擊文字即編輯**（click-to-edit）：span → input，`onBlur` 或 Enter 存檔。用於備註、下次計劃、交易紀錄等。
2. **編輯按鈕列模式**：按「編輯」整列切換成輸入框，「存」一次提交多欄。用於買方、成交、物件管理的結構化欄位。
3. **下拉即時切換**：select 的 `onChange` 直接存檔。用於追/募、同業/自售、買/租/賣。

### 日期格式
- `nowDatetime()` 產生本地 `yyyy-mm-dd HH:mm`（24 小時制），所有時間欄位皆以此格式存為 **text**。
- `toRocDate()` 將日期字串轉成「M月D日」顯示（用於維護紀錄）。

---

## 7. 資料庫最佳化紀錄

`migration.sql` 已對 schema 做下列調整：

- 移除 `clients.buyer_id` 死欄位與其外鍵。
- `maintenance_logs` / `business_logs` 的外鍵改為 `ON DELETE CASCADE`（刪客戶時連帶刪子紀錄）。
- 為外鍵欄位建索引（`client_id`、`property_no`）。
- `properties.property_no` 加 UNIQUE + 索引（需先確認無重複）。
- 各表 `created_at` 由 `date` 統一改為 `text`，與 `updated_at` 一致。

---

## 8. 已知限制 / 後續可改進

- **客戶↔買方以姓名連結**：同名或改名會出問題；若要更穩可改回 `buyer_id` 正式關聯。
- **多對多用 CSV 文字欄位**（`property_nos` / `watched_property_nos`）：無法用 SQL 直接 join、難查詢；正規化成 join table 可改善，但屬較大重構。
- **Realtime 全表重抓**：目前以 debounce 緩解；資料量大時可改為依事件 `payload.table` 做精準局部更新。
- **未使用元件**：`FilterBar.jsx`、`WatchingPropertiesPanel.jsx` 可移除。
- **錯誤處理**：寫入失敗目前多以 `.catch(console.error)` 吞掉，使用者無感知；可加 toast 提示。
