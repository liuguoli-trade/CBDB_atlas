# CBDB Atlas

**Languages / 語言：** [繁體中文](#繁體中文) · [English](#english) · [日本語](#日本語) · [한국어](#한국어) · [Tiếng Việt](#tiếng-việt)

---

## 繁體中文

### 關於 CBDB

[中國歷代人物傳記資料庫（CBDB，China Biographical Database）](https://cbdb.hsites.harvard.edu/) 是面向中國歷史研究的結構化傳記資料庫，由哈佛大學、中央研究院歷史語言研究所、北京大學等機構長期維護與更新。資料主要涵蓋唐至清等歷代人物，收錄數十萬計人物記錄，並將史籍、年譜、地方志等文獻中的傳記信息整理為可檢索、可關聯的結構化數據。

CBDB 不僅提供姓名、生卒、籍貫等基本信息，還包含任官履歷、親屬關係、社會交遊、入仕途徑、著述、事件、地址（行政區劃）及社會機構等多類關聯資料，適用於人物考證、群體傳記（prosopography）、社會網絡與歷史地理等研究。

除線上查詢外，CBDB 提供可離線使用的 SQLite 版本，便於本地批量分析與二次開發。最新發布見官方倉庫 [cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite)。

### 關於 CBDB Atlas

就我所見，文史哲研究長期存在「內容」與「工具」的割裂，即便已有 CBDB 這類完備的結構化傳記資料庫，您若要真正用起來，仍常須面對 SQLite、視圖與命令列等門檻。

CBDB Atlas 想做的，是把這杯「果汁」遞到您手邊——**提供一根吸管**：在瀏覽器中直查 CBDB，無需構建知識圖譜與繁複環境配置，讓人物、地名與關係檢索盡可能開箱可用。

CBDB Atlas 是在瀏覽器中直接查詢 CBDB SQLite 資料的本地 Web 應用。查詢邏輯外置於 `queries/` 目錄。

**主要功能：** 人物檢索與傳記詳情（別名、任官、親屬、入仕、著述等）；可視化關係圖（單人、家族、交游、關係探索）；網頁一鍵下載並校驗官方資料；人物詳情匯出 Excel。

### 當前進度與已知問題

目前主要對**人物、地名檢索**進行了精細調整，其他區塊可能仍存在問題。知識圖譜區塊目前僅提供篩選功能，尚未對關係進行整理——此舉是為保持資料原貌；待有了詳細的知識圖譜方案後，再進行相應調整。若有相關思路和討論，歡迎來信：1849682052@qq.com

### 使用方法

1. 執行 `pip install -e ".[dev]"` 安裝 Python 依賴，在專案目錄執行 `python run.py` 啟動服務。
2. Windows 可雙擊 `start_cbdb_atlas.bat` 自動啟動並開啟瀏覽器。
3. 在瀏覽器開啟 http://127.0.0.1:8770 。
4. **首次使用：** 在網頁點擊「更新資料」下載 CBDB；或手動將 SQLite 檔放入 `data/source/cbdb.sqlite3`，再執行 `scripts/create_views.sh`（Windows 可用 `scripts/create_views.bat`）建立便利視圖。
5. **建議（性能）：** 資料庫就緒後執行 `python scripts/build_indexes.py`（或分別執行 `build_search_index.py`、`build_graph_index.py`），可顯著加速人物檢索與關係探索；亦可於網頁使用「構建索引」。可視化入口：人物檢索結果 →「可視化檢索」，或 `/visual`。

### 開發者

本應用由 **liuguoli** 開發與維護。源碼：https://github.com/liuguoli-trade/CBDB_atlas · 測試：`pytest tests/ -v`

### 授權

[CBDB](https://cbdb.hsites.harvard.edu/) 資料及基於其的查詢結果，須遵守 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)（署名、非商業、相同方式共享）。本項目程式碼與輸出亦按此條款發布；使用時請署名 CBDB。

**CBDB Atlas 為獨立第三方工具**，與 CBDB 項目組、Harvard 及任何 CBDB 商業被許可方均無官方關係。

本工具供**非商業**研究使用，亦無權向您授予任何權利，商業用途須自行符合 CBDB 許可，您下載資料、查詢及匯出結果之合規責任由您自行承擔。詳見 [ATTRIBUTION.md](ATTRIBUTION.md)。

---

## English

### About CBDB

The [China Biographical Database (CBDB)](https://cbdb.hsites.harvard.edu/) is a structured biographical resource for Chinese history, maintained and updated by Harvard University, Academia Sinica (Institute of History and Philology), Peking University, and partners. It focuses chiefly on figures from the Tang through Qing periods, with hundreds of thousands of person records drawn from standard histories, nianpu, local gazetteers, and related sources.

CBDB links persons not only to basic biographical fields but also to offices held, kinship, social associations, entry paths, texts, events, administrative places, and institutions—supporting prosopography, network analysis, and historical geography.

For offline work, CBDB publishes SQLite releases suitable for local analysis and derivative tools. See [cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite) for the latest package.

### About CBDB Atlas

In my experience, humanities research often splits **substance** from **tools**, and even with a database as complete as CBDB, if you want to use it in daily work, SQLite, views, and the command line can still feel like a high bar.

CBDB Atlas is meant to be the **straw** for that glass of juice—browser-based access to CBDB without a heavy setup, so you can search persons, places, and relationships with minimal friction.

CBDB Atlas is a local web app for querying CBDB SQLite data in the browser. SQL queries live in `queries/`.

**Key features:** person search and biographical modules (alt names, postings, kinship, entry paths, texts, etc.); relationship visualization (individual, family, associates, graph exploration); one-click official data download with checksum verification; Excel export from person detail pages.

### Current status and known issues

Work so far has focused on refining **person and place-name search**; other modules may still have issues. The knowledge-graph area currently offers filtering only and does not reorganize relationships—this preserves the source data as-is. Relationship structuring will be revisited once a detailed knowledge-graph plan is in place. For related ideas or discussion, please email: 1849682052@qq.com

### Usage

1. Run `pip install -e ".[dev]"` to install dependencies, then run `python run.py` from the project root.
2. On Windows, double-click `start_cbdb_atlas.bat` to start the server and open the browser.
3. Open http://127.0.0.1:8770 in your browser.
4. **First run:** click **Update data** in the UI to download CBDB, or place the SQLite file at `data/source/cbdb.sqlite3` and run `scripts/create_views.sh` (Windows: `scripts/create_views.bat`) to create convenience views.
5. **Recommended (performance):** after the database is ready, run `python scripts/build_indexes.py` (or `build_search_index.py` and `build_graph_index.py` separately) for much faster person search and graph exploration; you can also use **Build index** in the UI. Open **Visual search** from person results, or visit `/visual`.

### Developer

Developed and maintained by **liuguoli**. Source: https://github.com/liuguoli-trade/CBDB_atlas · Tests: `pytest tests/ -v`

### License

[CBDB](https://cbdb.hsites.harvard.edu/) data and query results derived from it are under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (attribution, non-commercial, share-alike). This project’s code and outputs are released under the same terms. Please attribute CBDB when you use them.

**CBDB Atlas is an independent third-party tool**, not affiliated with the CBDB project, Harvard, or any CBDB commercial licensee.

The tool is intended for **non-commercial** research and has no authority to grant you any rights. Commercial use requires your own compliance with CBDB terms, and you are responsible for compliance regarding your downloads, queries, and exports. See [ATTRIBUTION.md](ATTRIBUTION.md).

---

## 日本語

### CBDB について

[中国歴代人物伝記資料庫（CBDB, China Biographical Database）](https://cbdb.hsites.harvard.edu/) は、中国史研究向けの構造化伝記データベースで、ハーバード大学、中央研究院歴史語言研究所、北京大学などが長期にわたり維持・更新しています。主に唐から清にかけての人物を対象とし、正史、年譜、地方志などから抽出した数十万件規模の人物記録を収録します。

CBDB には姓名・生没年・本貫などの基本情報のほか、官職、親族、交遊、入仕、著述、事件、住所（行政区画）、社会機関など多様な関連データが含まれ、人物考证、プロソポグラフィー、社会ネットワーク、歴史地理などの研究に利用できます。

オフライン利用向けに SQLite 版も提供されています。最新版は [cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite) を参照してください。

### CBDB Atlas について

私見では、文史哲の研究では「内容」と「ツール」の間に割裂があり、CBDB のような優れた伝記データベースがあっても、実際に使おうとすると SQLite やビュー、コマンドラインなどのハードルが残ります。

CBDB Atlas は、その「ジュース」に**ストロー**を添える試みです。ブラウザから CBDB を直接検索でき、知識グラフの構築や複雑な環境設定を避け、人物・地名・関係の検索をできるだけすぐ使える形にします。

CBDB Atlas は、ブラウザから CBDB SQLite を直接検索するローカル Web アプリです。クエリは `queries/` に外部配置されています。

**主な機能：** 人物検索と伝記モジュール（別名、任官、親族、入仕、著述など）、関係の可視化（個人・家族・交遊・関係探索）、公式データのワンクリック更新とチェックサム検証、人物詳細の Excel 出力。

### 現在の進捗と既知の問題

現時点では**人物・地名検索**を中心に調整を進めており、その他のモジュールには問題が残っている場合があります。知識グラフ欄は現状フィルターのみで、関係の整理は行っていません。これはデータの原貌を保つための措置です。詳細な知識グラフ方針が整い次第、改めて対応します。関連するアイデアやご討論はメールでご連絡ください：1849682052@qq.com

### 使い方

1. `pip install -e ".[dev]"` で依存関係をインストールし、プロジェクト直下で `python run.py` を実行します。
2. Windows では `start_cbdb_atlas.bat` をダブルクリックして起動できます。
3. ブラウザで http://127.0.0.1:8770 を開きます。
4. **初回：** Web 画面の「データ更新」から CBDB を取得するか、`data/source/cbdb.sqlite3` に SQLite を配置して `scripts/create_views.sh`（Windows は `scripts/create_views.bat`）で便利ビューを作成します。
5. **推奨（性能）：** データベース準備後、`python scripts/build_indexes.py`（または `build_search_index.py` / `build_graph_index.py`）を実行すると人物検索・関係探索が大幅に高速化します。画面の「索引構築」でも可。人物検索結果から「可視化検索」、または `/visual` へ。

### 開発者

**liuguoli** により開発・維護されています。ソース：https://github.com/liuguoli-trade/CBDB_atlas · テスト：`pytest tests/ -v`

### ライセンス

[CBDB](https://cbdb.hsites.harvard.edu/) のデータおよびそれに基づくクエリ結果は [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)（表示、非営利、同一条件での共有）に従います。本プロジェクトのコードと出力も同条件で公開しています。利用時は CBDB への表示をお願いします。

**CBDB Atlas は独立した第三者ツール**であり、CBDB プロジェクト、Harvard、CBDB の商業被許諾者との公式関係はありません。

本ツールは**非営利**の研究利用を想定しており、あなたにいかなる権利も付与する権限はありません。商業利用は CBDB の許諾に従ってください。データの取得・検索・出力の遵守はあなたの責任です。詳細は [ATTRIBUTION.md](ATTRIBUTION.md)。

---

## 한국어

### CBDB 소개

[중국역대인물전기자료库(CBDB, China Biographical Database)](https://cbdb.hsites.harvard.edu/)는 중국사 연구를 위한 구조화 전기 데이터베이스로, 하버드 대학, 중앙연구원 역사언어연구소, 베이징대학 등이 장기적으로 유지·갱신합니다. 주로 당부터 청까지의 인물을 다루며, 정사·년보·지방지 등에서 정리한 수십만 건 규모의 인물 기록을 담고 있습니다.

CBDB는 성명·생몰·관할 등 기본 정보 외에 관직, 친족, 교유, 입仕, 저술, 사건, 주소(행정구역), 사회기관 등 다양한 연관 데이터를 제공하여 인물考证, 프로소포그래피, 사회 네트워크, 역사지리 연구 등에 활용됩니다.

오프라인 분석을 위해 SQLite 배포판도 제공됩니다. 최신 버전은 [cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite)에서 확인할 수 있습니다.

### CBDB Atlas 소개

제가 보기에, 문사철 연구에서는 「내용」과 「도구」가 쉽게 갈라지며, CBDB처럼 훌륭한 전기 데이터베이스가 있어도, 실제로 활용하려면 SQLite, 뷰, 명령줄 등의 문턱을 넘어야 하는 경우가 많습니다.

CBDB Atlas는 그 「주스」에 **빨대**를 꽂아 드리려는 시도입니다. 브라우저에서 CBDB를 바로 조회하고, 지식 그래프 구축이나 복잡한 환경 설정 없이 인물·지명·관계 검색을 가능한 한 바로 쓸 수 있게 합니다.

CBDB Atlas는 브라우저에서 CBDB SQLite를 직접 조회하는 로컬 웹 애플리케이션입니다. 쿼리는 `queries/`에 분리되어 있습니다.

**주요 기능:** 인물 검색 및 전기 모듈(별칭, 임관, 친족, 입仕, 저술 등), 관계 시각화(개인·가족·교유·관계 탐색), 공식 데이터 원클릭 다운로드 및 체크섬 검증, 인물 상세 Excel 내보내기.

### 현재 진행 상황 및 알려진 문제

현재는 **인물·지명 검색**을 중심으로 세밀하게 다듬었으며, 다른 모듈에는 문제가 남아 있을 수 있습니다. 지식 그래프 영역은 현재 필터링만 제공하며 관계 정리는 하지 않습니다. 이는 원본 데이터의 형태를 유지하기 위함이며, 구체적인 지식 그래프 방안이 마련된 뒤 조정할 예정입니다. 관련 아이디어나 논의는 이메일로 연락 주세요: 1849682052@qq.com

### 사용 방법

1. `pip install -e ".[dev]"` 로 의존성을 설치한 뒤 프로젝트 루트에서 `python run.py`를 실행합니다.
2. Windows에서는 `start_cbdb_atlas.bat` 더블클릭으로 실행할 수 있습니다.
3. 브라우저에서 http://127.0.0.1:8770 을 엽니다.
4. **첫 실행:** 웹 UI에서「데이터 업데이트」로 CBDB를 받거나, SQLite 파일을 `data/source/cbdb.sqlite3`에 넣은 뒤 `scripts/create_views.sh`(Windows: `scripts/create_views.bat`)로 편의 뷰를 생성합니다.
5. **권장(성능):** DB 준비 후 `python scripts/build_indexes.py`(또는 `build_search_index.py`, `build_graph_index.py`)를 실행하면 인물 검색·관계 탐색이 크게 빨라집니다. UI의「인덱스 구축」도 가능. 인물 검색 결과에서「시각화 검색」, 또는 `/visual`.

### 개발자

**liuguoli** 이(가) 개발 및 유지보수합니다. 소스: https://github.com/liuguoli-trade/CBDB_atlas · 테스트: `pytest tests/ -v`

### 라이선스

[CBDB](https://cbdb.hsites.harvard.edu/) 데이터 및 이에 기반한 조회 결과는 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)(저작자 표시, 비영리, 동일 조건 변경 허락)을 따릅니다. 본 프로젝트 코드와 출력도 같은 조건으로 공개합니다. 이용 시 CBDB 표기를 부탁드립니다.

**CBDB Atlas는 독립적인 제3자 도구**이며, CBDB 프로젝트·Harvard·CBDB 상업 허가권자와 공식 관계가 없습니다.

본 도구는 **비영리** 연구용이며, 귀하에게 어떠한 권리도 부여할 권한이 없습니다. 상업적 이용은 CBDB 허가 조건을 스스로 준수해야 하며, 다운로드·조회·내보내기에 대한 준수 책임은 귀하에게 있습니다. [ATTRIBUTION.md](ATTRIBUTION.md) 참조.

---

## Tiếng Việt

### Giới thiệu CBDB

[Cơ sở dữ liệu tiểu sử Trung Quốc (CBDB, China Biographical Database)](https://cbdb.hsites.harvard.edu/) là cơ sở dữ liệu tiểu sử có cấu trúc phục vụ nghiên cứu lịch sử Trung Quốc, do Harvard, Viện Lịch sử và Ngữ văn thuộc Academia Sinica, Đại học Bắc Kinh và các đối tác duy trì lâu dài. CBDB tập trung chủ yếu vào nhân vật từ nhà Đường đến nhà Thanh, với hàng trăm nghìn hồ sơ rút ra từ sử liệu chính thống, niên phổ, phương chí địa phương và các nguồn liên quan.

CBDB không chỉ lưu thông tin cơ bản (tên, sinh mất, quê quán…) mà còn liên kết quan chức, họ hàng, quan hệ xã hội, con đường khoa cử, tác phẩm, sự kiện, địa danh hành chính và cơ quan xã hội—phục vụ khảo chứng nhân vật, prosopography, phân tích mạng lưới và địa lý lịch sử.

CBDB cũng phát hành bản SQLite để phân tích cục bộ và phát triển công cụ phái sinh. Xem [cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite) để lấy bản mới nhất.

### Giới thiệu CBDB Atlas

Theo kinh nghiệm của tôi, nghiên cứu nhân văn thường tách **nội dung** khỏi **công cụ**, dù đã có CBDB, khi quý vị muốn dùng thực tế, vẫn có thể gặp rào cản như SQLite, view và dòng lệnh.

CBDB Atlas muốn là **ống hút** cho ly 「nước ép」 đó: truy vấn CBDB trên trình duyệt, không cần dựng đồ thị tri thức hay cấu hình phức tạp, để tra cứu nhân vật, địa danh và quan hệ được dùng ngay.

CBDB Atlas là ứng dụng web cục bộ để truy vấn CBDB SQLite trực tiếp trên trình duyệt. Truy vấn SQL nằm trong `queries/`.

**Tính năng chính:** tìm kiếm nhân vật và hồ sơ tiểu sử (bí danh, nhậm chức, họ hàng, con đường khoa cử, tác phẩm…); trực quan hóa quan hệ (cá nhân, gia tộc, giao du, khám phá mạng lưới); tải dữ liệu chính thức một cú nhấp kèm kiểm tra checksum; xuất Excel từ trang chi tiết.

### Tiến độ hiện tại và vấn đề đã biết

Hiện tại đã tinh chỉnh chủ yếu **tìm kiếm nhân vật và địa danh**; các mô-đun khác có thể còn lỗi. Phần đồ thị tri thức mới có bộ lọc, chưa sắp xếp lại quan hệ—nhằm giữ nguyên dữ liệu gốc. Việc cấu trúc hóa quan hệ sẽ được xem xét khi có phương án đồ thị tri thức chi tiết. Nếu có ý tưởng hoặc muốn thảo luận, vui lòng gửi email: 1849682052@qq.com

### Cách sử dụng

1. Chạy `pip install -e ".[dev]"` để cài phụ thuộc, rồi chạy `python run.py` tại thư mục gốc dự án.
2. Trên Windows, nhấp đúp `start_cbdb_atlas.bat` để khởi động và mở trình duyệt.
3. Mở http://127.0.0.1:8770 trong trình duyệt.
4. **Lần đầu:** bấm **Cập nhật dữ liệu** trên giao diện web, hoặc đặt file SQLite vào `data/source/cbdb.sqlite3` rồi chạy `scripts/create_views.sh` (Windows: `scripts/create_views.bat`) để tạo các view tiện lợi.
5. **Khuyến nghị (hiệu năng):** sau khi có cơ sở dữ liệu, chạy `python scripts/build_indexes.py` (hoặc `build_search_index.py`, `build_graph_index.py`) để tìm kiếm nhân vật và khám phá quan hệ nhanh hơn nhiều; cũng có thể dùng **Xây chỉ mục** trên web. Mở **Tìm kiếm trực quan** từ kết quả nhân vật, hoặc truy cập `/visual`.

### Nhà phát triển

Do **liuguoli** phát triển và duy trì. Mã nguồn: https://github.com/liuguoli-trade/CBDB_atlas · Kiểm thử: `pytest tests/ -v`

### Giấy phép

Dữ liệu [CBDB](https://cbdb.hsites.harvard.edu/) và kết quả truy vấn dựa trên CBDB tuân theo [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (ghi công, phi thương mại, chia sẻ theo cùng điều kiện). Mã nguồn và đầu ra của dự án này cũng được công bố theo các điều khoản đó. Vui lòng ghi công CBDB khi sử dụng.

**CBDB Atlas là công cụ bên thứ ba độc lập**, không liên kết với dự án CBDB, Harvard hay bất kỳ bên được cấp phép thương mại CBDB nào.

Công cụ này dành cho nghiên cứu **phi thương mại** và không có quyền cấp cho quý vị bất kỳ quyền nào. Sử dụng thương mại phải tuân thủ điều khoản CBDB; quý vị tự chịu trách nhiệm về tải xuống, truy vấn và xuất dữ liệu. Xem [ATTRIBUTION.md](ATTRIBUTION.md).
