/**
 * Notion-Gemini統合システム - メイン統合ロジック（GAS完全対応版）
 * カスタムRAGシステム
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
  Logger.info('システム開始', { 'query': query, 'limit': limit });
  
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
    
    Logger.info('Notion本文検索完了', { 'found': notionData.length });
    
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
    
    Logger.info('システム完了', { 
      'processingTime': finalResult.metadata.processing_time_ms,
      'recentCount': finalResult.recent_records ? finalResult.recent_records.length : 0,
      'olderCount': finalResult.older_records ? finalResult.older_records.count : 0
    });
    
    return createSuccessResponse(finalResult, 'Notion-Gemini統合検索完了');
    
  } catch (error) {
    Logger.error('システムエラー', error);
    
    return createErrorResponse(
      '検索・要約処理でエラーが発生しました: ' + error.message,
      '処理時間: ' + (new Date() - startTime) + 'ms'
    );
  }
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
  
  if (query.length > 500) {
    Logger.warn('クエリが長すぎるため切り詰めます', { 'original': query.length });
    query = query.slice(0, 500);
  }
  
  // 制限値検証
  if (typeof limit !== 'number' || limit <= 0) {
    Logger.warn('無効な件数制限、デフォルト値使用', { 'original': limit });
    limit = CONFIG.DEFAULT_LIMIT;
  }
  
  if (limit > CONFIG.MAX_PAGE_SIZE) {
    Logger.warn('件数制限が上限を超過、上限値使用', { 'original': limit });
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
        
      default:
        throw new Error('未対応の関数: ' + functionName);
    }
    
    output.setContent(JSON.stringify(result, null, 2));
    return output;
    
  } catch (error) {
    Logger.error('Web API エラー', error);
    
    var errorOutput = ContentService.createTextOutput();
    errorOutput.setMimeType(ContentService.MimeType.JSON);
    errorOutput.setContent(JSON.stringify({
      'error': true,
      'message': error.message,
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
        
      default:
        throw new Error('未対応の関数: ' + requestData['function']);
    }
    
    output.setContent(JSON.stringify(result, null, 2));
    return output;
    
  } catch (error) {
    Logger.error('Web API POST エラー', error);
    
    var errorOutput = ContentService.createTextOutput();
    errorOutput.setMimeType(ContentService.MimeType.JSON);
    errorOutput.setContent(JSON.stringify({
      'error': true,
      'message': error.message,
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
  
  console.log('設定方法:');
  console.log('1. GASエディタのメニュー: プロジェクト設定 > スクリプトプロパティ');
  console.log('2. 以下のプロパティを追加:');
  console.log('   - NOTION_TOKEN: Notion統合のAPIトークン');
  console.log('   - GEMINI_API_KEY: Google AI Studio のAPIキー');
  console.log('   - DATABASE_ID: NotionデータベースID');
  
  console.log('=== セットアップ完了 ===');
}
