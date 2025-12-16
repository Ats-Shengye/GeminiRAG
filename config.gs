/**
 * Notion-Gemini統合システム - 設定とユーティリティ
 * カスタムRAGシステム
 */

/**
 * システム設定
 */
const CONFIG = {
  // API認証情報（プロジェクトプロパティで管理）
  NOTION_TOKEN: PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN'),
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
  DATABASE_ID: PropertiesService.getScriptProperties().getProperty('DATABASE_ID'),
  
  // Notion API設定
  NOTION_VERSION: '2022-06-28',
  MAX_PAGE_SIZE: 100,
  DEFAULT_LIMIT: 20,
  
  // Gemini API設定
  GEMINI_MODEL: 'gemini-2.5-pro',
  GEMINI_TEMPERATURE: 0.5,
  GEMINI_MAX_TOKENS: 2048,

  // リトライ設定（MEDIUM-02: 3→2回、BACKOFF 2→1.5）
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 1000,
  BACKOFF_MULTIPLIER: 1.5,

  // パフォーマンス設定（MEDIUM-01: 30秒→10秒）
  TIMEOUT_MS: 10000,
  RECENT_THRESHOLD_DAYS: 30
};

/**
 * システム初期化チェック
 */
function checkSystemConfig() {
  const required = ['NOTION_TOKEN', 'GEMINI_API_KEY', 'DATABASE_ID'];
  const missing = required.filter(key => !CONFIG[key]);

  if (missing.length > 0) {
    Logger.error('設定不備');
    throw new Error('システム設定に不備があります。管理者に連絡してください');
  }

  console.log('システム設定確認完了');
  return true;
}

/**
 * 指数バックオフリトライ実行
 * @param {Function} func - 実行する関数
 * @param {number} maxRetries - 最大リトライ回数
 * @param {string} context - エラー時のコンテキスト表示用
 */
function executeWithRetry(func, maxRetries = CONFIG.MAX_RETRIES, context = '') {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = func();
      if (attempt > 1) {
        console.log(`${context}: ${attempt}回目で成功`);
      }
      return result;
      
    } catch (error) {
      lastError = error;
      console.warn(`${context}: 試行${attempt}/${maxRetries}回目失敗: ${error.message}`);
      
      // 最後の試行以外は待機
      if (attempt < maxRetries) {
        const delay = CONFIG.RETRY_DELAY_MS * Math.pow(CONFIG.BACKOFF_MULTIPLIER, attempt - 1);
        console.log(`${delay}ms待機後にリトライ...`);
        Utilities.sleep(delay);
      }
    }
  }

  // 全試行失敗（内部ログに詳細、外部には汎用メッセージ）
  Logger.error('リトライ失敗');
  throw new Error('処理に失敗しました。しばらく時間をおいて再試行してください');
}

/**
 * 日付ユーティリティ - 最近のデータ判定
 * @param {string} dateStr - 日付文字列
 * @returns {boolean} - 最近のデータかどうか
 */
function isRecentDate(dateStr) {
  if (!dateStr) return false;
  
  const targetDate = new Date(dateStr);
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - CONFIG.RECENT_THRESHOLD_DAYS);
  
  return targetDate >= thresholdDate;
}

/**
 * エラーレスポンス生成
 * @param {string} message - エラーメッセージ
 * @param {string} details - 詳細情報
 */
function createErrorResponse(message, details = '') {
  return {
    error: true,
    message: message,
    details: details,
    timestamp: new Date().toISOString()
  };
}

/**
 * 成功レスポンス生成
 * @param {Object} data - レスポンスデータ
 * @param {string} context - コンテキスト情報
 */
function createSuccessResponse(data, context = '') {
  return {
    ...data,
    success: true,
    context: context,
    timestamp: new Date().toISOString()
  };
}

/**
 * API呼び出し共通設定
 */
function getApiOptions(method = 'GET', payload = null, additionalHeaders = {}) {
  const options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeaders
    }
  };
  
  if (payload && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.payload = typeof payload === 'string' ? payload : JSON.stringify(payload);
  }
  
  return options;
}

/**
 * ログ出力ユーティリティ
 * MEDIUM-05: メタデータ削減（フェーズ名のみ記録）
 */
const Logger = {
  info: (message) => {
    console.log(`[INFO] ${message}`);
  },

  warn: (message) => {
    console.warn(`[WARN] ${message}`);
  },

  error: (message) => {
    console.error(`[ERROR] ${message}`);
  },

  debug: (message) => {
    console.log(`[DEBUG] ${message}`);
  }
};
