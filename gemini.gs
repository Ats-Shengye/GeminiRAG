/**
 * Notion-Gemini統合システム - Gemini API専用モジュール
 * 翼用カスタムRAGシステム
 */

/**
 * Geminiを使ってNotionデータを要約
 * @param {string} query - 検索クエリ
 * @param {Array} notionData - Notionから取得したデータ配列
 * @returns {Object} - 構造化された要約結果
 */
function summarizeWithGemini(query, notionData) {
  Logger.info('Gemini要約開始', { query, dataCount: notionData.length });
  
  if (!notionData || notionData.length === 0) {
    return createNoDataResponse();
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const prompt = buildGeminiPrompt(query, notionData);
  const payload = buildGeminiPayload(prompt);
  const options = getApiOptions('POST', payload);
  
  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(url, options);
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Gemini API エラー: ${response.getResponseCode()}`);
    }
    
    const data = JSON.parse(response.getContentText());
    const result = parseGeminiResponse(data);
    
    Logger.info('Gemini要約完了', { summary: result.summary?.slice(0, 50) });
    return result;
    
  }, CONFIG.MAX_RETRIES, 'Gemini要約');
}

/**
 * Geminiプロンプト構築
 * @param {string} query - 検索クエリ
 * @param {Array} notionData - Notionデータ
 * @returns {string} - プロンプト文字列
 */
function buildGeminiPrompt(query, notionData) {
  const detailedData = notionData.map(item => ({
    title: item.title,
    content: item.content.slice(0, 800), // 詳細保持のため拡大
    category: item.category,
    importance: item.importance,
    tags: item.tags,
    date: item.date
  }));
  
  return `Notionデータから関連情報を抽出し、以下JSON形式で返答してください。

【クエリ】: ${query}
【データ】: ${JSON.stringify(detailedData, null, 2)}

【出力形式】:
{
  "summary": "詳細要約（思考プロセス・発見・結論を含む具体的内容）",
  "recent_records": [
    {"date": "日付", "title": "タイトル", "content": "具体的発言・思考・発見の詳細", "relevance": "高/中/低"}
  ],
  "older_records": {"count": 件数, "period": "期間", "summary": "要約"},
  "no_data": false
}

【重要指示】:
- 具体的な発言・思考プロセス・技術的発見・結論を詳細に記録
- 長期記憶として活用できるレベルの具体性を確保
- 抽象的な表現ではなく、実際の体験・判断・感情を含める
- 技術的な詳細・手法・結果・課題も具体的に記述
- 文脈・背景・その後の展開も含めて記録
- 元の内容の意味・方向性を正確に保持
- 発言の表現・言い回し・感情ニュアンスをできる限りそのまま記録
- recent_records: 直近1ヶ月のデータのみ
- older_records: それ以前のデータを要約
- 関連データなし時: "no_data": true
- 日付・数値・固有名詞を保持
- 関連度の高い順に並べる
- JSONのみ返答（説明文不要）
- 自然な日本語で記述`;
}

/**
 * Gemini APIペイロード構築
 * @param {string} prompt - プロンプト文字列
 * @returns {Object} - API送信用ペイロード
 */
function buildGeminiPayload(prompt) {
  return {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: CONFIG.GEMINI_TEMPERATURE,
      maxOutputTokens: CONFIG.GEMINI_MAX_TOKENS,
      candidateCount: 1,
      stopSequences: []
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH", 
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE"
      }
    ]
  };
}

/**
 * GeminiレスポンスからJSON抽出・パース
 * @param {Object} apiResponse - Gemini APIレスポンス
 * @returns {Object} - パース済みJSON
 */
function parseGeminiResponse(apiResponse) {
  try {
    // レスポンス構造の確認
    if (!apiResponse.candidates || !apiResponse.candidates[0]) {
      throw new Error('Gemini APIレスポンスが不正です: candidates が存在しません');
    }
    
    const candidate = apiResponse.candidates[0];
    if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
      throw new Error('Gemini APIレスポンスが不正です: content が存在しません');
    }
    
    const rawContent = candidate.content.parts[0].text;
    Logger.debug('Gemini生レスポンス', rawContent.slice(0, 200));
    
    // JSON抽出（複数パターン対応）
    const jsonContent = extractJsonFromText(rawContent);
    
    // JSON解析
    const parsedResult = JSON.parse(jsonContent);
    
    // 結果の検証・修正
    return validateAndFixResult(parsedResult);
    
  } catch (error) {
    Logger.error('Geminiレスポンス解析エラー', error);
    return createErrorResult(error.message);
  }
}

/**
 * テキストからJSON部分を抽出
 * @param {string} text - 生テキスト
 * @returns {string} - JSON文字列
 */
function extractJsonFromText(text) {
  // パターン1: ```json ブロック
  let jsonMatch = text.match(/```json\\s*(.*?)\\s*```/s);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  
  // パターン2: ```ブロック（jsonなし）
  jsonMatch = text.match(/```\\s*(.*?)\\s*```/s);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  
  // パターン3: { から } まで
  jsonMatch = text.match(/({.*})/s);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  
  // パターン4: そのまま（JSON形式の場合）
  try {
    JSON.parse(text.trim());
    return text.trim();
  } catch {
    // JSONではない
  }
  
  throw new Error(`JSON抽出失敗: ${text.slice(0, 100)}...`);
}

/**
 * 結果の検証・修正
 * @param {Object} result - パース済み結果
 * @returns {Object} - 検証・修正済み結果
 */
function validateAndFixResult(result) {
  // 必須フィールドの確認・補完
  const validated = {
    summary: result.summary || '要約の生成に失敗しました',
    recent_records: Array.isArray(result.recent_records) ? result.recent_records : [],
    older_records: result.older_records || { count: 0, period: '', summary: '' },
    no_data: result.no_data || false
  };
  
  // recent_recordsの構造確認
  validated.recent_records = validated.recent_records.map(record => ({
    date: record.date || '',
    title: record.title || '無題',
    content: record.content || '',
    relevance: ['高', '中', '低'].includes(record.relevance) ? record.relevance : '中'
  }));
  
  // older_recordsの構造確認
  if (typeof validated.older_records !== 'object' || validated.older_records === null) {
    validated.older_records = { count: 0, period: '', summary: '' };
  }
  
  validated.older_records.count = validated.older_records.count || 0;
  validated.older_records.period = validated.older_records.period || '';
  validated.older_records.summary = validated.older_records.summary || '';
  
  return validated;
}

/**
 * データなし時のレスポンス生成
 * @returns {Object} - データなしレスポンス
 */
function createNoDataResponse() {
  return {
    summary: "関連する記録は見つかりませんでした",
    recent_records: [],
    older_records: { count: 0, period: "", summary: "" },
    no_data: true
  };
}

/**
 * エラー時のレスポンス生成
 * @param {string} errorMessage - エラーメッセージ
 * @returns {Object} - エラーレスポンス
 */
function createErrorResult(errorMessage) {
  return {
    summary: `要約処理でエラーが発生しました: ${errorMessage}`,
    recent_records: [],
    older_records: { count: 0, period: "", summary: "" },
    no_data: true,
    error: true
  };
}

/**
 * Geminiテスト用関数
 * @param {string} testPrompt - テスト用プロンプト
 * @returns {string} - 生レスポンス
 */
function testGeminiApi(testPrompt = "Hello, this is a test.") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const payload = {
    contents: [{
      parts: [{ text: testPrompt }]
    }]
  };
  
  const options = getApiOptions('POST', payload);
  
  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    return data.candidates[0].content.parts[0].text;
  }, CONFIG.MAX_RETRIES, 'Geminiテスト');
}
