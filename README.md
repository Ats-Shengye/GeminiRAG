# Notion-Gemini統合RAGシステム

個人用長期記憶システムのためのNotion専用RAG（Retrieval Augmented Generation）実装

## 概要

NotionデータベースをGemini AIで要約・検索する統合システム。個人用知識管理システムです。
最終的にCloudflare上で構築したリモートMCPサーバーにエンドポイントを設定して呼び出しています。

### 特徴

- **Notion専用設計**: 一般LLMデータとの混在を避け、純粋な個人記録のみを情報源として使用
- **Gemini要約**: 検索結果をGemini AIが構造化要約し、関連度判定付きで出力
- **高速レスポンス**: 3秒以内での検索・要約完了
- **Web API対応**: GET/POSTリクエストで外部システムからの呼び出しが可能

## システム構成

```
外部システム → GAS Web API → Notion API + Gemini API → 構造化レスポンス
```

### 使用技術
- **Google Apps Script**: バックエンド・API層
- **Notion API**: データソース
- **Gemini API**: AI要約・関連度判定
- **Web API**: RESTful endpoint

## 開発背景

### 課題
- 既存RAGシステムの一般学習データ混入問題
- 長期記憶検索の精度・速度不足
- ハルシネーション（事実歪曲）の回避

### 解決アプローチ
- Notionデータベースのみを情報源とする専用RAG
- Geminiモデル選択による品質向上
- リアルタイム要約による情報整理

## API仕様

### エンドポイント

#### searchNotionWithGemini
Notionデータベースを検索し、Geminiで要約
```
GET /exec?function=searchNotionWithGemini&query={検索語}&limit={件数}&token={認証トークン}
```

#### searchNotionPagesWithContent
本文検索機能付きNotionページ検索（スコアリング付き）
```
GET /exec?function=searchNotionPagesWithContent&query={検索語}&limit={件数}&searchContent=true&token={認証トークン}
```

#### listRecentWithSummary
指定期間内の重要ページをGeminiで要約
```
GET /exec?function=listRecentWithSummary&days_back={日数}&importance_filter={重要度}&max_pages={件数}&token={認証トークン}
```

### レスポンス例
```json
{
  "summary": "検索クエリに関する要約",
  "recent_records": [
    {
      "title": "記録タイトル",
      "date": "2025-06-24T17:38:00.000+09:00",
      "content": "内容抜粋",
      "relevance": "高"
    }
  ],
  "older_records": {
    "count": 3,
    "period": "2025年1月〜5月",
    "summary": "期間内要約"
  },
  "metadata": {
    "total_found": 5,
    "processing_time_ms": 3105,
    "timestamp": "2025-06-24T09:01:21.191Z"
  }
}
```

## ファイル構成

```
├── config.gs          # 設定・共通ユーティリティ
├── notion.gs          # Notion API連携
├── gemini.gs          # Gemini API連携  
└── main.gs           # メイン統合ロジック・Web API
```

## セットアップ

### 1. GASプロジェクト作成
1. [Google Apps Script](https://script.google.com) でプロジェクト作成
2. 各.gsファイルをアップロード

### 2. API設定
スクリプトプロパティで以下を設定:
- `NOTION_TOKEN`: Notion統合APIトークン
- `GEMINI_API_KEY`: Google AI Studio APIキー
- `DATABASE_ID`: NotionデータベースID
- `API_AUTH_TOKEN`: API認証トークン（32文字以上、大小英字・数字・記号混在）

### 3. Notionデータベース構造
必要プロパティ:
- **内容** (Title): メインタイトル
- **カテゴリ** (Select): 分類
- **重要度** (Select): 優先度
- **タグ** (Rich Text): キーワード
- **日時** (Date): 作成日時

## セキュリティ

- **APIキー保護**: ScriptPropertiesで管理、HTTPヘッダー送信（URLパラメータ不使用）
- **API認証**: トークンベース認証、定数時間比較によるタイミング攻撃対策
- **トークン強度検証**: 32文字以上、大小英字・数字・記号混在を要求
- **Rate Limiting**: CacheServiceによるリクエスト頻度制限（10分間10リクエスト）
- **入力検証**: クエリ長制限、制御文字・JSON構造文字の拒否
- **エラー情報制限**: 内部実装詳細の外部露出防止
- **ログ機密保護**: 検索クエリ・個人データをログに記録しない
- **プロンプトインジェクション対策**: データエスケープ、セキュリティ指示による多層防御

## 技術的特徴

### 品質保証
- **事実歪曲対策**: Geminiモデル選択による精度向上
- **エラーハンドリング**: 指数バックオフリトライ
- **入力検証**: クエリ・パラメータの厳密チェック

### パフォーマンス
- **処理時間**: 平均3秒（通常クエリ）
- **同時処理**: GAS制限内での並列処理
- **キャッシュ**: 将来的な拡張予定

## 活用例

- 個人的な技術学習記録の検索・要約
- プロジェクト履歴の振り返り・分析
- 開発ナレッジの効率的な参照
- 長期記憶の外部化・構造化

## 今後の展開

- MCP（Model Context Protocol）サーバーとの統合
- 検索精度のさらなる向上
- リアルタイム記録機能の追加

---

**開発期間**: 2日（計7時間）  
**Status**: 運用中
