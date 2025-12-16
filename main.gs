/**
 * Notion-Gemini統合システム - メイン統合ロジック（GAS完全対応版）
 * 翼用カスタムRAGシステム
 */

/**
 * メイン関数：クエリに基づいてNotionから情報検索＆Gemini要約
 * MCP関数として公開される
 * @param {string} query - 検索クエリ
 * @param {number} limit - 取得件数上限
 * @returns {Object} - 構造化された検索・要約結果
 */
function searchNotionWithGemini(query, limit) {
  if (typeof limit === 'undefined') {
    limit = CONFIG.DEFAULT_LIMIT;
  }
  
  var startTime = new Date();
  Logger.info('システム開始');
  
  try {
    // 1. システム設定確認
    checkSystemConfig();
    
    // 2. 入力値検証
    var validatedParams = validateInput(query, limit);
    query = validatedParams.query;
    limit = validatedParams.limit;
    
    // 3. Notion本文検索実行（ハイブリッド方式）
    Logger.info('Notion本文検索フェーズ開始');
    var notionData = searchNotionPagesWithContent(query, limit, true);
    
    if (!notionData || notionData.length === 0) {
      Logger.info('検索結果なし');
      return createSuccessResponse(createNoDataResponse(), 'データなし');
    }
    
    Logger.info('Notion本文検索完了');
    
    // 4. Gemini要約実行
    Logger.info('Gemini要約フェーズ開始');
    var geminiResult = summarizeWithGemini(query, notionData);
    
    // 5. レスポンス最終化（ハイブリッド情報付き）
    var finalResult = {
      'summary': geminiResult.summary,
      'recent_records': geminiResult.recent_records,
      'older_records': geminiResult.older_records,
      'no_data': geminiResult.no_data,
      'page_ids': notionData.map(function(item) { return item.id; }),
      'scores': notionData.map(function(item) { return { 'id': item.id, 'score': item.score || 0 }; }),
      'metadata': {
        'query': query,
        'total_found': notionData.length,
        'processing_time_ms': new Date() - startTime,
        'timestamp': new Date().toISOString()
      }
    };
    
    Logger.info('システム完了');
    
    return createSuccessResponse(finalResult, 'Notion-Gemini統合検索完了');
    
  } catch (error) {
    Logger.error('システムエラー');

    return createErrorResponse(
      '検索・要約処理でエラーが発生しました。しばらく時間をおいて再試行してください',
      ''
    );
  }
}

/**
 * クライアントID取得（MEDIUM-07: 検証強化）
 * @param {Object} headers - リクエストヘッダー
 * @returns {string} - クライアント識別子
 */
function getClientId(headers) {
  if (!headers) {
    return 'unknown';
  }

  // X-Forwarded-Forから最初のIPのみ使用
  var xForwardedFor = headers['X-Forwarded-For'];
  if (xForwardedFor) {
    var firstIp = xForwardedFor.split(',')[0].trim();

    // IPv4検証（簡易）
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(firstIp)) {
      var parts = firstIp.split('.');
      if (parts.every(function(part) { return parseInt(part, 10) <= 255; })) {
        return firstIp;
      }
    }

    // IPv6検証（簡易）
    if (/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(firstIp)) {
      return firstIp;
    }
  }

  // フォールバック: User-Agent
  return headers['User-Agent'] || 'unknown';
}

/**
 * Rate Limitingチェック
 * @param {string} clientId - クライアント識別子（IPアドレス等）
 * @returns {boolean} - リクエスト許可/拒否
 */
function checkRateLimit(clientId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'ratelimit_' + clientId;
  var currentCount = cache.get(cacheKey);

  // 10分間に10リクエスト制限
  var maxRequests = 10;
  var windowSeconds = 600; // 10分

  if (currentCount === null) {
    // 初回リクエスト
    cache.put(cacheKey, '1', windowSeconds);
    return true;
  }

  var count = parseInt(currentCount, 10);
  if (count >= maxRequests) {
    Logger.warn('Rate limit exceeded');
    return false;
  }

  // カウント増加
  cache.put(cacheKey, String(count + 1), windowSeconds);
  return true;
}

/**
 * 定数時間比較（HIGH-03: タイミング攻撃対策）
 * @param {string} a - 比較文字列1
 * @param {string} b - 比較文字列2
 * @returns {boolean} - 一致判定
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * トークン強度検証（MEDIUM-03: 強度検証）
 * @param {string} token - 検証対象トークン
 * @returns {boolean} - 強度十分か
 */
function validateTokenStrength(token) {
  if (!token || token.length < 32) {
    return false;
  }

  // 大文字・小文字・数字・記号の混在確認
  var hasLower = /[a-z]/.test(token);
  var hasUpper = /[A-Z]/.test(token);
  var hasDigit = /[0-9]/.test(token);
  var hasSymbol = /[^a-zA-Z0-9]/.test(token);

  return hasLower && hasUpper && hasDigit && hasSymbol;
}

/**
 * リクエスト認証
 * @param {Object} e - GASリクエストイベントオブジェクト
 * @returns {boolean} - 認証成否
 */
function authenticateRequest(e) {
  var expectedToken = PropertiesService.getScriptProperties().getProperty('API_AUTH_TOKEN');

  // トークンが設定されていない場合は認証不要とする（後方互換性）
  if (!expectedToken) {
    Logger.warn('API_AUTH_TOKEN が設定されていません。セキュリティリスクのため、設定を推奨します');
    return true;
  }

  // トークン強度検証（MEDIUM-03）
  if (!validateTokenStrength(expectedToken)) {
    Logger.error('トークン強度不足');
    // 汎用エラーメッセージで応答（詳細は隠蔽）
    return false;
  }

  var providedToken = null;

  // パラメータからトークン取得
  if (e.parameter && e.parameter.token) {
    providedToken = e.parameter.token;
  }

  // Authorizationヘッダーからトークン取得（Bearer形式）
  if (!providedToken && e.headers && e.headers.Authorization) {
    var authHeader = e.headers.Authorization;
    if (authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.substring(7);
    }
  }

  // トークン検証（HIGH-03: 定数時間比較）
  if (!providedToken || !constantTimeCompare(providedToken, expectedToken)) {
    Logger.error('認証失敗');
    return false;
  }

  return true;
}

/**
 * 入力値検証・正規化
 * @param {string} query - 検索クエリ
 * @param {number} limit - 取得件数
 * @returns {Object} - 検証済みパラメータ
 */
function validateInput(query, limit) {
  // クエリ検証
  if (!query || typeof query !== 'string') {
    throw new Error('検索クエリが指定されていません');
  }

  query = query.trim();
  if (query.length === 0) {
    throw new Error('検索クエリが空です');
  }

  // 制御文字チェック（0x00-0x1F、0x7F）
  if (/[\x00-\x1F\x7F]/.test(query)) {
    Logger.error('入力検証エラー');
    throw new Error('無効な文字が含まれています');
  }

  // JSON構造文字の拒否（インジェクション対策）
  if (/[{}[\]]/.test(query)) {
    Logger.error('入力検証エラー');
    throw new Error('無効な文字が含まれています');
  }

  if (query.length > 500) {
    Logger.warn('クエリ長超過');
    query = query.slice(0, 500);
  }

  // 制限値検証
  if (typeof limit !== 'number' || limit <= 0) {
    Logger.warn('無効な件数制限、デフォルト値使用');
    limit = CONFIG.DEFAULT_LIMIT;
  }

  if (limit > CONFIG.MAX_PAGE_SIZE) {
    Logger.warn('件数制限が上限を超過、上限値使用');
    limit = CONFIG.MAX_PAGE_SIZE;
  }
  
  return { 'query': query, 'limit': limit };
}

/**
 * Web API エンドポイント（doGet用）
 * GET /exec?function=searchNotionWithGemini&query=検索語&limit=20
 */
function doGet(e) {
  var params = e.parameter;

  try {
    // Rate Limitingチェック（MEDIUM-07: クライアント識別子検証強化）
    var clientId = getClientId(e.headers);
    if (!checkRateLimit(clientId)) {
      var rateLimitOutput = ContentService.createTextOutput();
      rateLimitOutput.setMimeType(ContentService.MimeType.JSON);
      rateLimitOutput.setContent(JSON.stringify({
        'error': true,
        'message': 'リクエスト制限に達しました。しばらく時間をおいてから再試行してください',
        'timestamp': new Date().toISOString()
      }, null, 2));
      return rateLimitOutput;
    }

    // 認証チェック
    if (!authenticateRequest(e)) {
      var errorOutput = ContentService.createTextOutput();
      errorOutput.setMimeType(ContentService.MimeType.JSON);
      errorOutput.setContent(JSON.stringify({
        'error': true,
        'message': '認証に失敗しました',
        'timestamp': new Date().toISOString()
      }, null, 2));
      return errorOutput;
    }

    var output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);
    
    var functionName = params['function'];
    if (!functionName) {
      throw new Error('function パラメータが必要です');
    }
    
    var result;
    
    switch (functionName) {
      case 'searchNotionWithGemini':
        var query = params.query;
        var limit = params.limit ? parseInt(params.limit) : CONFIG.DEFAULT_LIMIT;
        result = searchNotionWithGemini(query, limit);
        break;
        
      case 'getRecentPages':
        var recentLimit = params.limit ? parseInt(params.limit) : 10;
        result = getRecentPages(recentLimit);
        break;
        
      case 'testSystem':
        result = testSystemStatus();
        break;
        
      case 'searchNotionPagesWithContent':
        var query = params.query;
        var limit = params.limit ? parseInt(params.limit) : CONFIG.DEFAULT_LIMIT;
        var searchContent = params.searchContent !== 'false'; // デフォルトtrue
        result = searchNotionPagesWithContent(query, limit, searchContent);
        break;
        
      case 'debugHybridSearch':
        result = debugHybridSearchWeb();
        break;
        
      case 'listRecentWithSummary':
        var options = {
          days_back: params.days_back ? parseInt(params.days_back) : 3,
          importance_filter: params.importance_filter ? params.importance_filter.split(',') : null,
          max_pages: params.max_pages ? parseInt(params.max_pages) : 10,
          category: params.category || null,
          sort_by: params.sort_by || 'importance'
        };
        result = listRecentWithSummary(options);
        break;
        
      default:
        throw new Error('未対応の関数: ' + functionName);
    }
    
    output.setContent(JSON.stringify(result, null, 2));
    return output;
    
  } catch (error) {
    Logger.error('Web API エラー');

    var errorOutput = ContentService.createTextOutput();
    errorOutput.setMimeType(ContentService.MimeType.JSON);
    errorOutput.setContent(JSON.stringify({
      'error': true,
      'message': 'リクエスト処理中にエラーが発生しました',
      'timestamp': new Date().toISOString()
    }, null, 2));

    return errorOutput;
  }
}

/**
 * Web API エンドポイント（doPost用）
 */
function doPost(e) {
  try {
    // Rate Limitingチェック（MEDIUM-07: クライアント識別子検証強化）
    var clientId = getClientId(e.headers);
    if (!checkRateLimit(clientId)) {
      var rateLimitOutput = ContentService.createTextOutput();
      rateLimitOutput.setMimeType(ContentService.MimeType.JSON);
      rateLimitOutput.setContent(JSON.stringify({
        'error': true,
        'message': 'リクエスト制限に達しました。しばらく時間をおいてから再試行してください',
        'timestamp': new Date().toISOString()
      }, null, 2));
      return rateLimitOutput;
    }

    // 認証チェック
    if (!authenticateRequest(e)) {
      var errorOutput = ContentService.createTextOutput();
      errorOutput.setMimeType(ContentService.MimeType.JSON);
      errorOutput.setContent(JSON.stringify({
        'error': true,
        'message': '認証に失敗しました',
        'timestamp': new Date().toISOString()
      }, null, 2));
      return errorOutput;
    }

    var requestData = JSON.parse(e.postData.contents);

    var output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);
    
    var result;
    
    switch (requestData['function']) {
      case 'searchNotionWithGemini':
        result = searchNotionWithGemini(
          requestData.query,
          requestData.limit || CONFIG.DEFAULT_LIMIT
        );
        break;
        
      case 'searchNotionPagesWithContent':
        result = searchNotionPagesWithContent(
          requestData.query,
          requestData.limit || CONFIG.DEFAULT_LIMIT,
          requestData.searchContent !== false  // デフォルトtrue
        );
        break;
        
      case 'listRecentWithSummary':
        var options = {
          days_back: requestData.days_back || 3,
          importance_filter: requestData.importance_filter || null,
          max_pages: requestData.max_pages || 10,
          category: requestData.category || null,
          sort_by: requestData.sort_by || 'importance'
        };
        result = listRecentWithSummary(options);
        break;
        
      default:
        throw new Error('未対応の関数: ' + requestData['function']);
    }
    
    output.setContent(JSON.stringify(result, null, 2));
    return output;
    
  } catch (error) {
    Logger.error('Web API POST エラー');

    var errorOutput = ContentService.createTextOutput();
    errorOutput.setMimeType(ContentService.MimeType.JSON);
    errorOutput.setContent(JSON.stringify({
      'error': true,
      'message': 'リクエスト処理中にエラーが発生しました',
      'timestamp': new Date().toISOString()
    }, null, 2));

    return errorOutput;
  }
}

/**
 * システム状態テスト
 */
function testSystemStatus() {
  var tests = [];
  
  try {
    checkSystemConfig();
    tests.push({ 'name': '設定確認', 'status': 'OK' });
  } catch (error) {
    tests.push({ 'name': '設定確認', 'status': 'ERROR', 'error': error.message });
  }
  
  try {
    var dbInfo = getDatabaseInfo();
    var title = '';
    if (dbInfo.title && dbInfo.title[0] && dbInfo.title[0].text) {
      title = dbInfo.title[0].text.content;
    }
    tests.push({ 'name': 'Notion API', 'status': 'OK', 'title': title });
  } catch (error) {
    tests.push({ 'name': 'Notion API', 'status': 'ERROR', 'error': error.message });
  }
  
  try {
    var geminiTest = testGeminiApi('テスト');
    tests.push({ 'name': 'Gemini API', 'status': 'OK', 'response': geminiTest.slice(0, 50) });
  } catch (error) {
    tests.push({ 'name': 'Gemini API', 'status': 'ERROR', 'error': error.message });
  }
  
  try {
    var recent = getRecentPages(3);
    tests.push({ 'name': '最新記録取得', 'status': 'OK', 'count': recent.length });
  } catch (error) {
    tests.push({ 'name': '最新記録取得', 'status': 'ERROR', 'error': error.message });
  }
  
  var allOk = tests.every(function(test) {
    return test.status === 'OK';
  });
  
  return {
    'overall_status': allOk ? 'OK' : 'ERROR',
    'tests': tests,
    'timestamp': new Date().toISOString()
  };
}

/**
 * 手動テスト実行用関数
 */
function runManualTest() {
  console.log('=== システムテスト開始 ===');
  
  var status = testSystemStatus();
  console.log('システム状態:', status);
  
  console.log('=== 検索テスト ===');
  var testResult = searchNotionWithGemini('MCP', 5);
  console.log('検索結果:', testResult);
  
  console.log('=== テスト完了 ===');
}

/**
 * 期間要約手動テスト実行用関数
 */
function runListRecentTest() {
  console.log('=== 期間要約テスト開始 ===');
  
  // デフォルトテスト（過去3日間）
  console.log('1. デフォルトテスト（過去3日間）');
  var defaultResult = listRecentWithSummary({});
  console.log('デフォルト結果:', defaultResult);
  
  // 重要度フィルタテスト
  console.log('2. 重要度フィルタテスト（最重要・高のみ）');
  var importanceResult = listRecentWithSummary({
    days_back: 5,
    importance_filter: ['最重要', '高'],
    max_pages: 5
  });
  console.log('重要度フィルタ結果:', importanceResult);
  
  // カテゴリフィルタテスト
  console.log('3. カテゴリフィルタテスト（転職活動）');
  var categoryResult = listRecentWithSummary({
    days_back: 7,
    category: '転職活動',
    max_pages: 15
  });
  console.log('カテゴリフィルタ結果:', categoryResult);
  
  console.log('=== 期間要約テスト完了 ===');
}

/**
 * フィルタ付き最新ページ取得テスト
 */
function testRecentPagesWithFilters() {
  console.log('=== フィルタ付きページ取得テスト ===');
  
  var testOptions = {
    days_back: 3,
    importance_filter: ['最重要', '高'],
    max_pages: 5,
    sort_by: 'importance'
  };
  
  var result = getRecentPagesWithFilters(testOptions);
  console.log('フィルタ結果:', result);
  console.log('取得件数:', result.length);
  
  if (result.length > 0) {
    console.log('最初のページ詳細:', {
      title: result[0].title,
      date: result[0].date,
      importance: result[0].importance,
      category: result[0].category,
      contentLength: result[0].content ? result[0].content.length : 0
    });
  }
  
  console.log('=== フィルタテスト完了 ===');
}

/**
 * ハイブリッド検索デバッグテスト
 */
function debugHybridSearch() {
  console.log('=== ハイブリッド検索デバッグ ===');
  
  // 1. 本文検索テスト
  console.log('1. 本文検索テスト');
  var contentResults = searchNotionPagesWithContent('AIシテル', 3, true);
  console.log('本文検索結果:', JSON.stringify(contentResults, null, 2));
  
  // 2. Geminiプロンプトテスト
  if (contentResults.length > 0) {
    console.log('2. Geminiプロンプトテスト');
    var prompt = buildGeminiPrompt('AIシテル', contentResults);
    console.log('Geminiプロンプト長さ:', prompt.length);
    console.log('プロンプト抜粋:', prompt.slice(0, 500));
  }
  
  console.log('=== デバッグ完了 ===');
}

/**
 * Web API用ハイブリッド検索デバッグ
 */
function debugHybridSearchWeb() {
  try {
    var debugInfo = {
      timestamp: new Date().toISOString(),
      steps: []
    };
    
    // 1. 本文検索テスト
    debugInfo.steps.push('本文検索テスト開始');
    var contentResults = searchNotionPagesWithContent('AIシテル', 3, true);
    
    debugInfo.contentResults = {
      count: contentResults.length,
      data: contentResults.map(function(item) {
        return {
          id: item.id,
          title: item.title,
          contentLength: item.content ? item.content.length : 0,
          contentPreview: item.content ? item.content.slice(0, 100) : '',
          score: item.score,
          category: item.category,
          tags: item.tags
        };
      })
    };
    
    // 2. Geminiプロンプトテスト
    if (contentResults.length > 0) {
      debugInfo.steps.push('Geminiプロンプト生成テスト');
      var prompt = buildGeminiPrompt('AIシテル', contentResults);
      
      debugInfo.geminiPrompt = {
        length: prompt.length,
        preview: prompt.slice(0, 500),
        dataSection: prompt.includes('【データ】:') ? 'データセクションあり' : 'データセクションなし'
      };
    }
    
    debugInfo.steps.push('デバッグ完了');
    
    return createSuccessResponse(debugInfo, 'ハイブリッド検索デバッグ完了');
    
  } catch (error) {
    return createErrorResponse('デバッグエラー: ' + error.message);
  }
}

/**
 * 期間内重要ページのGemini要約（list_recent_with_summary）
 * @param {Object} options - フィルタオプション
 * @returns {Object} - 期間要約結果
 */
function listRecentWithSummary(options = {}) {
  const {
    days_back = 3,
    importance_filter = null,
    max_pages = 10,
    category = null,
    sort_by = 'importance'
  } = options;
  
  var startTime = new Date();
  Logger.info('期間要約システム開始');
  
  try {
    // 1. システム設定確認
    checkSystemConfig();
    
    // 2. 入力値検証
    var validatedOptions = validateListRecentOptions(options);
    
    // 3. フィルタ付き最新ページ取得
    Logger.info('フィルタ付きページ取得フェーズ開始');
    var recentPages = getRecentPagesWithFilters(validatedOptions);
    
    if (!recentPages || recentPages.length === 0) {
      Logger.info('期間内データなし');
      var noDataResult = createNoPeriodDataResponse(validatedOptions.days_back);
      noDataResult.processing_info = {
        gemini_tokens_used: 0,
        processing_time_ms: new Date() - startTime
      };
      return createSuccessResponse(noDataResult, '期間要約完了（データなし）');
    }
    
    Logger.info('フィルタ付きページ取得完了');
    
    // 4. Gemini期間要約実行
    Logger.info('Gemini期間要約フェーズ開始');
    var summaryResult = summarizeRecentPages(recentPages, validatedOptions);
    
    // 5. レスポンス最終化
    var finalResult = {
      summary: summaryResult.summary,
      period: summaryResult.period,
      pages_processed: summaryResult.pages_processed,
      processing_info: {
        gemini_tokens_used: 'unknown', // GASではトークン数取得不可
        processing_time_ms: new Date() - startTime
      }
    };
    
    Logger.info('期間要約システム完了');
    
    return createSuccessResponse(finalResult, '期間要約完了');
    
  } catch (error) {
    Logger.error('期間要約システムエラー');

    return createErrorResponse(
      '期間要約処理でエラーが発生しました。しばらく時間をおいて再試行してください',
      ''
    );
  }
}

/**
 * listRecentWithSummary入力値検証
 * @param {Object} options - 入力オプション
 * @returns {Object} - 検証済みオプション
 */
function validateListRecentOptions(options) {
  var validated = {
    days_back: 3,
    importance_filter: null,
    max_pages: 10,
    category: null,
    sort_by: 'importance'
  };
  
  // days_back検証
  if (options.days_back && typeof options.days_back === 'number' && options.days_back > 0) {
    validated.days_back = Math.min(options.days_back, 30); // 最大30日
  }
  
  // importance_filter検証
  if (options.importance_filter && Array.isArray(options.importance_filter)) {
    var validImportance = ['最重要', '高', '中', '低'];
    validated.importance_filter = options.importance_filter.filter(function(imp) {
      return validImportance.includes(imp);
    });
    if (validated.importance_filter.length === 0) {
      validated.importance_filter = null;
    }
  }
  
  // max_pages検証
  if (options.max_pages && typeof options.max_pages === 'number' && options.max_pages > 0) {
    validated.max_pages = Math.min(options.max_pages, 50); // 最大50件
  }
  
  // category検証
  if (options.category && typeof options.category === 'string' && options.category.trim()) {
    validated.category = options.category.trim();
  }
  
  // sort_by検証
  if (options.sort_by && ['importance', 'date'].includes(options.sort_by)) {
    validated.sort_by = options.sort_by;
  }
  
  return validated;
}

/**
 * セットアップ用関数（初回実行時）
 */
function setupSystem() {
  console.log('=== システムセットアップ ===');
  
  var properties = PropertiesService.getScriptProperties();
  var required = ['NOTION_TOKEN', 'GEMINI_API_KEY', 'DATABASE_ID'];
  
  console.log('必要な設定項目:');
  required.forEach(function(key) {
    var value = properties.getProperty(key);
    console.log(key + ': ' + (value ? '設定済み' : '未設定'));
  });

  // API_AUTH_TOKEN強度検証
  var authToken = properties.getProperty('API_AUTH_TOKEN');
  if (authToken) {
    if (authToken.length < 32) {
      console.log('警告: API_AUTH_TOKENが短すぎます（最小32文字必要）');
    } else if (!/[a-z]/.test(authToken) || !/[A-Z]/.test(authToken) ||
               !/[0-9]/.test(authToken) || !/[^a-zA-Z0-9]/.test(authToken)) {
      console.log('警告: API_AUTH_TOKENの複雑性が不十分です（大小英字・数字・記号を含める必要があります）');
    } else {
      console.log('API_AUTH_TOKEN: 設定済み（強度OK）');
    }
  } else {
    console.log('警告: API_AUTH_TOKENが未設定です。セキュリティリスクがあります');
  }
  
  console.log('設定方法:');
  console.log('1. GASエディタのメニュー: プロジェクト設定 > スクリプトプロパティ');
  console.log('2. 以下のプロパティを追加:');
  console.log('   - NOTION_TOKEN: Notion統合のAPIトークン');
  console.log('   - GEMINI_API_KEY: Google AI Studio のAPIキー');
  console.log('   - DATABASE_ID: NotionデータベースID');
  
  console.log('=== 新機能使用方法 ===');
  console.log('listRecentWithSummary: 期間内重要ページのGemini要約');
  console.log('Web API: GET /exec?function=listRecentWithSummary&days_back=3&importance_filter=最重要,高');
  console.log('手動テスト: runListRecentTest()');
  console.log('フィルタテスト: testRecentPagesWithFilters()');
  
  console.log('=== セットアップ完了 ===');
}
