/**
 * Notion-Gemini統合システム - Notion API専用モジュール
 * 翼用カスタムRAGシステム
 */

/**
 * Notionデータベース検索
 * @param {string} query - 検索クエリ
 * @param {number} limit - 取得件数上限
 * @returns {Array} - 検索結果配列
 */
function searchNotionPages(query, limit = CONFIG.DEFAULT_LIMIT) {
  Logger.info('Notion検索開始');
  
  const url = `https://api.notion.com/v1/databases/${CONFIG.DATABASE_ID}/query`;
  const payload = buildSearchPayload(query, limit);
  const options = getApiOptions('POST', payload, {
    'Authorization': `Bearer ${CONFIG.NOTION_TOKEN}`,
    'Notion-Version': CONFIG.NOTION_VERSION
  });
  
  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(url, options);
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Notion API エラー: ${response.getResponseCode()}`);
    }
    
    const data = JSON.parse(response.getContentText());
    const results = data.results.map(formatNotionPage);
    
    Logger.info('Notion検索完了');
    return results;
    
  }, CONFIG.MAX_RETRIES, 'Notion検索');
}

/**
 * 検索ペイロード構築（複数語検索対応）
 * @param {string} query - 検索クエリ
 * @param {number} limit - 取得件数
 * @returns {Object} - API送信用ペイロード
 */
function buildSearchPayload(query, limit) {
  // スペースで分割して複数語検索に対応
  const keywords = query.trim().split(/\s+/).filter(k => k.length > 0);
  
  if (keywords.length === 0) {
    throw new Error('有効な検索キーワードがありません');
  }
  
  // 各キーワードでフィルターを生成
  const orFilters = [];
  
  keywords.forEach(keyword => {
    // タイトル検索
    orFilters.push({
      property: "内容",
      title: {
        contains: keyword
      }
    });
    
    // タグ検索
    orFilters.push({
      property: "タグ",
      rich_text: {
        contains: keyword
      }
    });
    
    // カテゴリ検索（完全一致のみ）
    orFilters.push({
      property: "カテゴリ",
      select: {
        equals: keyword
      }
    });
  });
  
  return {
    filter: {
      or: orFilters
    },
    sorts: [
      {
        property: "日時",
        direction: "descending"
      },
      {
        property: "重要度",
        direction: "descending"
      }
    ],
    page_size: Math.min(limit, CONFIG.MAX_PAGE_SIZE)
  };
}

/**
 * Notionページデータの整形
 * @param {Object} page - Notion APIレスポンスのページオブジェクト
 * @returns {Object} - 整形済みページデータ
 */
function formatNotionPage(page) {
  try {
    return {
      id: page.id,
      title: extractTitle(page.properties.内容),
      content: '', // 本文は別途blocks取得が必要
      category: extractSelect(page.properties.カテゴリ),
      importance: extractSelect(page.properties.重要度),
      tags: extractRichText(page.properties.タグ),
      date: extractDate(page.properties.日時) || page.created_time,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      url: page.url
    };
  } catch (error) {
    Logger.error('ページ整形エラー', error);
    return {
      id: page.id,
      title: '取得エラー',
      content: `データ整形に失敗: ${error.message}`,
      category: '',
      importance: '',
      tags: '',
      date: page.created_time,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      url: page.url
    };
  }
}

/**
 * Notionプロパティ抽出関数群
 */

/**
 * タイトルプロパティ抽出
 */
function extractTitle(titleProperty) {
  if (!titleProperty?.title?.length) return '無題';
  return titleProperty.title[0]?.text?.content || '無題';
}

/**
 * リッチテキストプロパティ抽出
 */
function extractRichText(richTextProperty) {
  if (!richTextProperty?.rich_text?.length) return '';
  
  return richTextProperty.rich_text
    .map(block => block.text?.content || '')
    .join('')
    .slice(0, 500); // 長すぎる場合は切り詰め
}

/**
 * セレクトプロパティ抽出
 */
function extractSelect(selectProperty) {
  return selectProperty?.select?.name || '';
}

/**
 * マルチセレクトプロパティ抽出
 */
function extractMultiSelect(multiSelectProperty) {
  if (!multiSelectProperty?.multi_select?.length) return [];
  return multiSelectProperty.multi_select.map(option => option.name);
}

/**
 * 日付プロパティ抽出
 */
function extractDate(dateProperty) {
  return dateProperty?.date?.start || null;
}

/**
 * 最近の記録とそれ以前の記録に分類
 * @param {Array} pages - ページデータ配列
 * @returns {Object} - 分類結果
 */
function categorizeByDate(pages) {
  const recent = [];
  const older = [];
  
  pages.forEach(page => {
    if (isRecentDate(page.date)) {
      recent.push(page);
    } else {
      older.push(page);
    }
  });
  
  return {
    recent: recent,
    older: older,
    total: pages.length
  };
}

/**
 * データベース情報取得（デバッグ用）
 * @returns {Object} - データベース情報
 */
function getDatabaseInfo() {
  const url = `https://api.notion.com/v1/databases/${CONFIG.DATABASE_ID}`;
  const options = getApiOptions('GET', null, {
    'Authorization': `Bearer ${CONFIG.NOTION_TOKEN}`,
    'Notion-Version': CONFIG.NOTION_VERSION
  });
  
  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(url, options);
    return JSON.parse(response.getContentText());
  }, CONFIG.MAX_RETRIES, 'データベース情報取得');
}

/**
 * 最新記録取得（テスト用）
 * @param {number} limit - 取得件数
 * @returns {Array} - 最新記録配列
 */
function getRecentPages(limit = 10) {
  Logger.info('最新記録取得開始');
  
  const url = `https://api.notion.com/v1/databases/${CONFIG.DATABASE_ID}/query`;
  const payload = {
    sorts: [
      {
        property: "日時",
        direction: "descending"
      }
    ],
    page_size: Math.min(limit, CONFIG.MAX_PAGE_SIZE)
  };
  
  const options = getApiOptions('POST', payload, {
    'Authorization': `Bearer ${CONFIG.NOTION_TOKEN}`,
    'Notion-Version': CONFIG.NOTION_VERSION
  });
  
  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    return data.results.map(formatNotionPage);
  }, CONFIG.MAX_RETRIES, '最新記録取得');
}

/**
 * ページ本文を取得
 * @param {string} pageId - NotionページID
 * @returns {Object} - ブロック配列またはエラー情報
 */
function getPageContent(pageId) {
  const url = `https://api.notion.com/v1/blocks/${pageId}/children`;
  const options = getApiOptions('GET', null, {
    'Authorization': `Bearer ${CONFIG.NOTION_TOKEN}`,
    'Notion-Version': CONFIG.NOTION_VERSION
  });
  
  return executeWithRetry(() => {
    try {
      const response = UrlFetchApp.fetch(url, options);
      
      if (response.getResponseCode() !== 200) {
        Logger.error('ページ本文取得エラー', {
          pageId,
          status: response.getResponseCode(),
          response: response.getContentText()
        });
        return { error: true, blocks: [] };
      }
      
      const data = JSON.parse(response.getContentText());
      return { error: false, blocks: data.results || [] };
      
    } catch (error) {
      Logger.error('ページ本文取得例外', { pageId, error: error.message });
      return { error: true, blocks: [] };
    }
  }, 2, 'ページ本文取得'); // 本文取得は2回まで
}

/**
 * ブロックからテキストを抽出
 * @param {Array} blocks - Notionブロック配列
 * @returns {string} - 抽出されたテキスト
 */
function extractTextFromBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }
  
  const textParts = [];
  
  blocks.forEach(block => {
    try {
      let text = '';
      
      switch (block.type) {
        case 'paragraph':
          text = extractRichTextContent(block.paragraph?.rich_text);
          break;
        case 'heading_1':
          text = extractRichTextContent(block.heading_1?.rich_text);
          break;
        case 'heading_2':
          text = extractRichTextContent(block.heading_2?.rich_text);
          break;
        case 'heading_3':
          text = extractRichTextContent(block.heading_3?.rich_text);
          break;
        case 'bulleted_list_item':
          text = extractRichTextContent(block.bulleted_list_item?.rich_text);
          break;
        case 'numbered_list_item':
          text = extractRichTextContent(block.numbered_list_item?.rich_text);
          break;
        case 'to_do':
          text = extractRichTextContent(block.to_do?.rich_text);
          break;
        case 'toggle':
          text = extractRichTextContent(block.toggle?.rich_text);
          break;
        case 'quote':
          text = extractRichTextContent(block.quote?.rich_text);
          break;
        case 'callout':
          text = extractRichTextContent(block.callout?.rich_text);
          break;
        case 'code':
          text = extractRichTextContent(block.code?.rich_text);
          break;
        default:
          // その他のブロックタイプはスキップ
          break;
      }
      
      if (text.trim()) {
        textParts.push(text.trim());
      }
    } catch (error) {
      Logger.error('ブロックテキスト抽出エラー', { 
        blockType: block.type, 
        error: error.message 
      });
    }
  });
  
  return textParts.join(' ').slice(0, 1000); // 最大1000文字
}

/**
 * rich_textからテキスト内容を抽出
 * @param {Array} richText - rich_text配列
 * @returns {string} - 抽出されたテキスト
 */
function extractRichTextContent(richText) {
  if (!Array.isArray(richText) || richText.length === 0) {
    return '';
  }
  
  return richText
    .map(text => text.plain_text || text.text?.content || '')
    .join('')
    .trim();
}

/**
 * 本文検索機能付きNotionページ検索
 * @param {string} query - 検索クエリ
 * @param {number} limit - 取得件数上限
 * @param {boolean} searchContent - 本文検索を有効にするか
 * @returns {Array} - 検索結果配列（スコア順）
 */
function searchNotionPagesWithContent(query, limit = CONFIG.DEFAULT_LIMIT, searchContent = true) {
  Logger.info('本文検索開始', { queryLength: query.length, limit, searchContent });
  
  if (!searchContent) {
    // 本文検索を無効にした場合は既存の検索を使用
    return searchNotionPages(query, limit);
  }
  
  // 通常の検索でベースとなるページを取得（多めに取得）
  const baseLimit = Math.min(limit * 3, 100);
  const baseResults = searchNotionPages(query, baseLimit);
  
  // 各ページにスコアを付けて検索
  const scoredResults = [];
  
  baseResults.forEach(page => {
    let score = 0;
    const queryLower = query.toLowerCase();
    
    // タイトルマッチ（10点）
    if (page.title.toLowerCase().includes(queryLower)) {
      score += 10;
    }
    
    // タグマッチ（5点）
    if (page.tags.toLowerCase().includes(queryLower)) {
      score += 5;
    }
    
    // カテゴリマッチ（5点）
    if (page.category.toLowerCase().includes(queryLower)) {
      score += 5;
    }
    
    // 本文検索
    const contentResult = getPageContent(page.id);
    if (!contentResult.error && contentResult.blocks.length > 0) {
      const content = extractTextFromBlocks(contentResult.blocks);
      page.content = content; // 本文を設定
      
      // 本文マッチ（マッチ回数×2点、最大8点）
      const contentLower = content.toLowerCase();
      const escapedQuery = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = (contentLower.match(new RegExp(escapedQuery, 'g')) || []).length;
      score += Math.min(matches * 2, 8);
    } else {
      page.content = ''; // 本文取得失敗時は空文字
    }
    
    // スコアが0より大きいページのみ追加
    if (score > 0) {
      // GAS互換のためスプレッド演算子を使わず明示的にコピー
      var pageWithScore = {
        id: page.id,
        title: page.title,
        content: page.content,
        category: page.category,
        importance: page.importance,
        tags: page.tags,
        date: page.date,
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
        url: page.url,
        score: score
      };
      scoredResults.push(pageWithScore);
    }
  });
  
  // スコア順にソート（同スコアの場合は日付降順）
  scoredResults.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return new Date(b.date) - new Date(a.date);
  });
  
  const results = scoredResults.slice(0, limit);
  
  Logger.info('本文検索完了', { 
    found: results.length, 
    searched: baseResults.length,
    avgScore: results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0
  });
  
  return results;
}

/**
 * Notionページデータの整形（本文取得オプション付き）
 * @param {Object} page - Notion APIレスポンスのページオブジェクト
 * @param {boolean} includeContent - 本文を含めるか
 * @returns {Object} - 整形済みページデータ
 */
function formatNotionPageWithContent(page, includeContent = false) {
  const formattedPage = formatNotionPage(page);
  
  if (includeContent) {
    const contentResult = getPageContent(page.id);
    if (!contentResult.error && contentResult.blocks.length > 0) {
      formattedPage.content = extractTextFromBlocks(contentResult.blocks);
    }
  }
  
  return formattedPage;
}

/**
 * フィルタ機能付き最新ページ取得
 * @param {Object} options - フィルタオプション
 * @returns {Array} - フィルタ済みページ配列
 */
function getRecentPagesWithFilters(options = {}) {
  const {
    days_back = 3,
    importance_filter = null,
    max_pages = 10,
    category = null,
    sort_by = 'date'
  } = options;

  Logger.info('フィルタ付き最新ページ取得開始');
  
  // 日付フィルタ計算
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days_back);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  const url = `https://api.notion.com/v1/databases/${CONFIG.DATABASE_ID}/query`;
  const payload = buildFilteredSearchPayload(startDateStr, importance_filter, category, max_pages * 2, sort_by);
  const options_api = getApiOptions('POST', payload, {
    'Authorization': `Bearer ${CONFIG.NOTION_TOKEN}`,
    'Notion-Version': CONFIG.NOTION_VERSION
  });
  
  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(url, options_api);
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Notion API エラー: ${response.getResponseCode()}`);
    }
    
    const data = JSON.parse(response.getContentText());
    let results = data.results.map(formatNotionPage);
    
    // 日付後フィルタ（APIフィルタで取りこぼしがある場合の保険）
    results = results.filter(page => {
      const pageDate = new Date(page.date);
      return pageDate >= startDate;
    });
    
    // 本文を取得
    results.forEach(page => {
      const contentResult = getPageContent(page.id);
      if (!contentResult.error && contentResult.blocks.length > 0) {
        page.content = extractTextFromBlocks(contentResult.blocks);
      } else {
        page.content = '';
      }
    });
    
    // ソート
    if (sort_by === 'importance') {
      const importanceOrder = { '最重要': 4, '高': 3, '中': 2, '低': 1, '': 0 };
      results.sort((a, b) => {
        const aScore = importanceOrder[a.importance] || 0;
        const bScore = importanceOrder[b.importance] || 0;
        if (aScore !== bScore) {
          return bScore - aScore; // 重要度降順
        }
        return new Date(b.date) - new Date(a.date); // 同じ重要度なら日付降順
      });
    } else {
      // デフォルトは日付降順
      results.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    
    // 件数制限
    const finalResults = results.slice(0, max_pages);
    
    Logger.info('フィルタ付き最新ページ取得完了', { 
      found: finalResults.length, 
      searched: results.length,
      period: `${startDateStr}以降`
    });
    
    return finalResults;
    
  }, CONFIG.MAX_RETRIES, 'フィルタ付き最新ページ取得');
}

/**
 * フィルタ検索用ペイロード構築
 * @param {string} startDate - 開始日（YYYY-MM-DD形式）
 * @param {Array} importanceFilter - 重要度フィルタ
 * @param {string} category - カテゴリフィルタ
 * @param {number} limit - 取得件数
 * @param {string} sortBy - ソート基準
 * @returns {Object} - API送信用ペイロード
 */
function buildFilteredSearchPayload(startDate, importanceFilter, category, limit, sortBy) {
  const filters = [];
  
  // 日付フィルタ
  filters.push({
    property: "日時",
    date: {
      on_or_after: startDate
    }
  });
  
  // 重要度フィルタ
  if (importanceFilter && Array.isArray(importanceFilter) && importanceFilter.length > 0) {
    if (importanceFilter.length === 1) {
      filters.push({
        property: "重要度",
        select: {
          equals: importanceFilter[0]
        }
      });
    } else {
      filters.push({
        or: importanceFilter.map(imp => ({
          property: "重要度",
          select: {
            equals: imp
          }
        }))
      });
    }
  }
  
  // カテゴリフィルタ
  if (category) {
    filters.push({
      property: "カテゴリ",
      select: {
        equals: category
      }
    });
  }
  
  // ソート設定
  const sorts = [];
  if (sortBy === 'importance') {
    sorts.push({
      property: "重要度",
      direction: "descending"
    });
  }
  sorts.push({
    property: "日時",
    direction: "descending"
  });
  
  return {
    filter: filters.length > 1 ? { and: filters } : filters[0],
    sorts: sorts,
    page_size: Math.min(limit, CONFIG.MAX_PAGE_SIZE)
  };
}
