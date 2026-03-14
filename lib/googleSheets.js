const { google } = require("googleapis");
const path = require("path");

let _sheets = null;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MM_YY_PATTERN = /^(\d{2})-(\d{2})$/;
const SUMMARY_SHEET = "Summary";

function getClient() {
  if (_sheets) return _sheets;

  const keyPath = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

function getSheetId(meta, sheetName) {
  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );
  return sheet ? sheet.properties.sheetId : null;
}

function styleHeaderRequests(sheetId) {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: "gridProperties.frozenRowCount",
      },
    },
  ];
}

function numberFormatRequests(sheetId, columnIndices) {
  return columnIndices.map((col) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: col,
        endColumnIndex: col + 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "NUMBER", pattern: "#,##0.00" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  }));
}

async function ensureSheet(spreadsheetId, sheetName, headers, numberColumns) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

  if (existing) return true;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });

  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  if (headers && headers.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });

    const formatRequests = [
      ...styleHeaderRequests(newSheetId),
      ...(numberColumns ? numberFormatRequests(newSheetId, numberColumns) : []),
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  }

  return false;
}

async function sheetExists(spreadsheetId, sheetName) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets.some((s) => s.properties.title === sheetName);
}

async function deleteSheetIfExists(spreadsheetId, sheetName) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetId = getSheetId(meta, sheetName);
  if (sheetId === null) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteSheet: { sheetId } }],
    },
  });
  return true;
}

async function appendRow(spreadsheetId, sheetName, row) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || "";
  const match = updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function appendRows(spreadsheetId, sheetName, rows) {
  if (!rows.length) return null;
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  const updatedRange = res.data.updates?.updatedRange || "";
  const match = updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function getColumn(spreadsheetId, sheetName, column) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${column}:${column}`,
  });
  return (res.data.values || []).flat();
}

async function updateSummary(spreadsheetId) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  const monthlyTabs = meta.data.sheets
    .map((s) => s.properties.title)
    .filter((name) => MM_YY_PATTERN.test(name));

  const allCurrencies = new Set();
  const monthlyData = [];

  for (const tab of monthlyTabs) {
    const [, mm, yy] = tab.match(MM_YY_PATTERN);
    const month = parseInt(mm, 10);
    const year = 2000 + parseInt(yy, 10);

    const totals = await getColumn(spreadsheetId, tab, "G");
    const currencies = await getColumn(spreadsheetId, tab, "H");

    const sums = {};
    for (let i = 1; i < totals.length; i++) {
      const currency = (currencies[i] || "USD").toUpperCase().trim();
      const amount = parseFloat(totals[i]) || 0;
      allCurrencies.add(currency);
      sums[currency] = (sums[currency] || 0) + amount;
    }

    Object.keys(sums).forEach((c) => {
      sums[c] = Math.round(sums[c] * 100) / 100;
    });

    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    monthlyData.push({ label, sums, year, month });
  }

  monthlyData.sort((a, b) => b.year - a.year || b.month - a.month);

  const sortedCurrencies = [...allCurrencies].sort();
  const headerRow = ["Month", ...sortedCurrencies];

  let summarySheetId = getSheetId(meta, SUMMARY_SHEET);

  if (summarySheetId === null) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SUMMARY_SHEET } } }],
      },
    });
    summarySheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  } else {
    const existingCharts = meta.data.sheets
      .find((s) => s.properties.sheetId === summarySheetId)
      ?.charts || [];

    const deleteChartRequests = existingCharts.map((c) => ({
      deleteEmbeddedObject: { objectId: c.chartId },
    }));

    const clearRequests = [
      {
        updateCells: {
          range: { sheetId: summarySheetId },
          fields: "userEnteredValue,userEnteredFormat",
        },
      },
      ...deleteChartRequests,
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: clearRequests },
    });
  }

  const dataRows = monthlyData.map((m) => [
    m.label,
    ...sortedCurrencies.map((c) => m.sums[c] || 0),
  ]);
  const rows = [headerRow, ...dataRows];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SUMMARY_SHEET}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  const dataRowCount = monthlyData.length;
  const currencyColIndices = sortedCurrencies.map((_, i) => i + 1);

  const formatRequests = [
    ...styleHeaderRequests(summarySheetId),
    ...numberFormatRequests(summarySheetId, currencyColIndices),
    {
      updateSheetProperties: {
        properties: { sheetId: summarySheetId, index: 0 },
        fields: "index",
      },
    },
  ];

  if (dataRowCount > 0 && sortedCurrencies.length > 0) {
    const series = sortedCurrencies.map((_, i) => ({
      series: {
        sourceRange: {
          sources: [{
            sheetId: summarySheetId,
            startRowIndex: 0,
            endRowIndex: dataRowCount + 1,
            startColumnIndex: i + 1,
            endColumnIndex: i + 2,
          }],
        },
      },
      targetAxis: "LEFT_AXIS",
    }));

    formatRequests.push({
      addChart: {
        chart: {
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: summarySheetId,
                rowIndex: 1,
                columnIndex: sortedCurrencies.length + 2,
              },
              widthPixels: 800,
              heightPixels: 400,
            },
          },
          spec: {
            title: "Monthly Expenses by Currency",
            basicChart: {
              chartType: "BAR",
              legendPosition: "BOTTOM_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS", title: "Total" },
                { position: "LEFT_AXIS", title: "Month" },
              ],
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [{
                        sheetId: summarySheetId,
                        startRowIndex: 0,
                        endRowIndex: dataRowCount + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 1,
                      }],
                    },
                  },
                },
              ],
              series,
              headerCount: 1,
            },
          },
        },
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: formatRequests },
  });
}

module.exports = {
  ensureSheet,
  sheetExists,
  deleteSheetIfExists,
  appendRow,
  appendRows,
  getColumn,
  updateSummary,
};
