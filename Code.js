/**
 * @fileoverview Google Apps Script for the "Memory of SWC 2568" website.
 * This script serves the HTML file and handles data retrieval from Google Sheets.
 */

// Define the ID of the Google Sheet.
const SPREADSHEET_ID = '1oq1NW5g-FGuCXhqiZccxXtxiCkUGEum5KErUvqEOlmw';
const DATA_TAB_NAMES = ['6_1', '6_2', '6_3', '6_4', '6_5', '6_6', '6_7', '6_8'];

/**
 * Handles the HTTP GET request and serves the web page.
 */
function doGet(e) {
  try {
    // Check if this is an API request
    if (e.parameter && e.parameter.action === 'getGuestbook') {
      const data = getGuestbookData();
      return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Otherwise serve the HTML
    const htmlOutput = HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Memory of SWC 2568');

    htmlOutput.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    return htmlOutput;

  } catch (error) {
    // Global error handler for doGet
    console.error('Critical Error in doGet: ' + error.toString());
    return ContentService.createTextOutput("System Error: " + error.toString());
  }
}

/**
 * Includes the content of a file into the HTML template.
 * @param {string} filename - The name of the file to include.
 * @returns {string} - The content of the file.
 */
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

/**
 * ดึงข้อมูลรูปภาพจาก URL ภายนอกที่เป็น HTTP และแปลงเป็น Base64
 * เพื่อหลีกเลี่ยงปัญหา Mixed Content เมื่อรันบน HTTPS
 * @param {string} url - URL ของรูปภาพ (เช่น http://www.swc.ac.th/pic/Logo/swc.png)
 * @returns {string} - Base64 string ของรูปภาพ
 */
function getSecureImageUrl(url) {
  try {
    // 1. ดึงข้อมูลรูปภาพจาก URL ภายนอก
    const response = UrlFetchApp.fetch(url);

    // 2. รับ Blob ของรูปภาพ
    const blob = response.getBlob();

    // 3. แปลง Blob เป็น Base64 string
    const base64Data = Utilities.base64Encode(blob.getBytes());

    // 4. ส่ง Base64 string กลับไป
    return base64Data;

  } catch (e) {
    // ในกรณีที่ดึงข้อมูลล้มเหลว (เช่น URL ผิด หรือเซิร์ฟเวอร์ปลายทางมีปัญหา)
    Logger.log('Error fetching image: ' + e.toString());
    return ''; // ส่งค่าว่างกลับไป ทำให้ Fallback ทำงาน
  }
}

/**
 * Retrieves the private VTR link and Letter text for a given student ID.
 * Optimized using TextFinder for faster search.
 */
function getPrivateContent(studentId) {
  console.log('Received request for student ID: ' + studentId);
  const trimmedId = String(studentId).trim();

  // Basic validation
  if (!trimmedId) {
    return {
      status: 'error',
      message: 'กรุณากรอกเลขประจำตัวนักเรียน'
    };
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Use TextFinder to search across the entire spreadsheet (or specific sheets if needed)
    // Here we iterate tabs to be safe and specific, but TextFinder is much faster than getValues() loop

    for (const tabName of DATA_TAB_NAMES) {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) continue;

      // Create a TextFinder for this sheet
      // We only search in Column A (Student ID) to be precise and fast
      const finder = sheet.getRange("A:A").createTextFinder(trimmedId).matchEntireCell(true);
      const result = finder.findNext();

      if (result) {
        // Found the ID! Get the row index
        const rowIndex = result.getRow();

        // Fetch only the necessary data for this student (Columns B to E)
        // Assuming structure: ID(A), Name(B), Class(C), VTR(D), Letter(E)
        const studentDataRange = sheet.getRange(rowIndex, 2, 1, 4); // Get 1 row, 4 columns starting from col 2
        const rowValues = studentDataRange.getValues()[0];

        const studentData = {
          name: rowValues[0], // Column B
          class: rowValues[1], // Column C
          teacherVtrLink: rowValues[2], // Column D
          privateLetterText: rowValues[3] // Column E
        };

        console.log('Data found for student: ' + studentData.name + ' in tab: ' + tabName);
        return {
          status: 'success',
          data: studentData
        };
      }
    }

    // If loop finishes without finding a match
    return {
      status: 'not_found',
      message: 'ไม่พบเลขประจำตัวนักเรียนนี้ในระบบ (ค้นหาในห้อง 6/1 - 6/8 แล้ว)'
    };

  } catch (e) {
    console.error('General error in getPrivateContent: ' + e.toString());
    return {
      status: 'error',
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูล: ' + e.toString()
    };
  }
}

// ==========================================
// GUESTBOOK LOGIC
// ==========================================
const GUESTBOOK_TAB_NAME = 'Guestbook';
const GUESTBOOK_IMAGE_FOLDER_ID = ''; // Optional: Specify a folder ID if you want to keep organized, otherwise root

/**
 * Checks for profanity in the given text.
 * @param {string} text - The text to check.
 * @returns {boolean} - True if profanity is found, false otherwise.
 */
function checkProfanity(text) {
  if (!text) return false;

  // List of banned words (Thai and English common ones)
  const bannedWords = [
    'kuy', 'sus', 'fuck', 'shit', 'bitch', 'asshole',
    'ควย', 'สัส', 'เหี้ย', 'เย็ด', 'มึง', 'กู', 'แม่ง', 'ดอกทอง', 'ร่าน', 'ตอแหล',
    'พ่อมึงตาย', 'แม่มึงตาย'
  ];

  const lowerText = text.toLowerCase();
  return bannedWords.some(word => lowerText.includes(word));
}

/**
 * Saves a base64 image to Google Drive and returns the file URL.
 * @param {string} base64Data - The base64 string of the image.
 * @param {string} fileName - The name for the file.
 * @returns {string} - The URL of the saved image.
 */
function saveImageToDrive(base64Data, fileName) {
  try {
    // Extract the base64 part (remove "data:image/jpeg;base64," prefix if present)
    const splitData = base64Data.split(',');
    const data = splitData.length > 1 ? splitData[1] : splitData[0];

    const blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', fileName);

    let folder;
    if (GUESTBOOK_IMAGE_FOLDER_ID) {
      try {
        folder = DriveApp.getFolderById(GUESTBOOK_IMAGE_FOLDER_ID);
      } catch (e) {
        folder = DriveApp.getRootFolder();
      }
    } else {
      // Create a folder if not exists (simple check) or just use root
      const folders = DriveApp.getFoldersByName("Guestbook_Images");
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder("Guestbook_Images");
      }
    }

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return `https://drive.google.com/uc?export=view&id=${file.getId()}`;
  } catch (e) {
    console.error("Error saving image: " + e.toString());
    return "";
  }
}

/**
 * Handles HTTP POST requests for the Guestbook.
 */
function doPost(e) {
  // Use LockService to prevent concurrent writes
  const lock = LockService.getScriptLock();
  try {
    // Wait for up to 30 seconds for other processes to finish.
    lock.waitLock(30000);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'Server is busy, please try again later.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const data = JSON.parse(e.postData.contents);
    const result = saveGuestbook(data);

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': e.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Saves guestbook data to the sheet.
 * Callable from both doPost and google.script.run
 */
function saveGuestbook(data) {
  // 0. Input Validation
  if (!data.name || data.name.length > 50) {
    throw new Error("ชื่อต้องไม่ว่างและไม่เกิน 50 ตัวอักษร");
  }
  if (!data.message || data.message.length > 500) {
    throw new Error("ข้อความต้องไม่ว่างและไม่เกิน 500 ตัวอักษร");
  }

  // 1. Profanity Check
  if (checkProfanity(data.message) || checkProfanity(data.name)) {
    throw new Error("โปรดใช้ถ้อยคำที่สุภาพ (Please use polite language)");
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(GUESTBOOK_TAB_NAME);

  // Create sheet if not exists
  if (!sheet) {
    sheet = ss.insertSheet(GUESTBOOK_TAB_NAME);
    sheet.appendRow(['Timestamp', 'Name', 'Role', 'Message', 'Date', 'ImageURL']);
  }

  const timestamp = new Date();
  let imageUrl = "";

  // 2. Image Handling
  if (data.image) {
    const fileName = `guestbook_${timestamp.getTime()}.jpg`;
    imageUrl = saveImageToDrive(data.image, fileName);
  }

  // Append row
  sheet.appendRow([
    timestamp,
    data.name,
    data.role,
    data.message,
    Utilities.formatDate(timestamp, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
    imageUrl
  ]);

  return { 'result': 'success' };
}

/**
 * Helper to get guestbook data for the frontend
 * This is called via doGet with ?action=getGuestbook
 */
function getGuestbookData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Case-insensitive sheet search
    const sheets = ss.getSheets();
    let sheet = sheets.find(s => s.getName().toLowerCase() === GUESTBOOK_TAB_NAME.toLowerCase());

    if (!sheet) {
      console.log('Guestbook sheet not found.');
      return []; // Return empty array instead of error object for cleaner frontend handling
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return []; // Header only or empty
    }

    // Optimize: Read only the last 50 rows instead of the whole sheet  
    const startRow = Math.max(2, lastRow - 49);
    const numRows = lastRow - startRow + 1;

    const range = sheet.getRange(startRow, 1, numRows, 6); // Assuming 6 columns
    const rows = range.getValues();

    // Return entries reversed (newest first)
    return rows.reverse().map(row => ({
      timestamp: row[0] ? new Date(row[0]).toISOString() : new Date().toISOString(),
      name: String(row[1] || 'Unknown'),
      role: String(row[2] || 'friend'),
      message: String(row[3] || ''),
      dateStr: String(row[4] || ''),
      imageUrl: String(row[5] || '')
    }));

  } catch (e) {
    console.error('Error getting guestbook: ' + e.toString());
    return [{
      name: "System Error",
      role: "secret",
      message: "Error: " + e.toString(),
      timestamp: new Date()
    }];
  }
}