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
  Logger.info('Notion検索開始', { query, limit });
  
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
    
    Logger.info('Notion検索完了', { found: results.length });
    return results;
    
  }, CONFIG.MAX_RETRIES, 'Notion検索');
}

/**
 * 検索ペイロード構築
 * @param {string} query - 検索クエリ
 * @param {number} limit - 取得件数
 * @returns {Object} - API送信用ペイロード
 */
function buildSearchPayload(query, limit) {
  return {
    filter: {
      or: [
        {
          property: "内容",
          title: {
            contains: query
          }
        },
        {
          property: "タグ",
          rich_text: {
            contains: query
          }
        },
        {
          property: "カテゴリ",
          select: {
            equals: query
          }
        }
      ]
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
  Logger.info('最新記録取得開始', { limit });
  
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
