
import { GoogleGenAI } from "@google/genai";
import { AttendanceLog, Employee } from '../types';

/**
 * Biometric Facial Recognition via Gemini.
 * Uses structured JSON output for strictly reliable parsing.
 */
export const identifyEmployee = async (
  cameraFrameBase64: string, 
  employees: Employee[]
): Promise<string | null> => {
  if (!employees || employees.length === 0) return null;

  // Initialize AI client inside the function to ensure up-to-date API key usage.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // 1. Prepare Gallery
  // STRICT FILTER: Only allow employees with valid Data URI photos (Base64).
  // We cannot pass raw URLs to Gemini inlineData if we couldn't download them locally (due to CORS).
  const gallery = employees.filter(e => 
    e.photoUrl && 
    e.photoUrl.length > 100 && 
    e.photoUrl.startsWith('data:image')
  );

  // If no employees have valid photos, we can't identify anyone.
  if (gallery.length === 0) return null;

  const galleryParts = [];
  for (const emp of gallery) {
    // Handle both data URI and raw base64 if it happens
    let base64Data = emp.photoUrl;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1];
    }
    
    galleryParts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Data
      }
    });
  }

  // Add the current camera frame to compare against as the LAST image
  galleryParts.push({
    inlineData: {
      mimeType: 'image/jpeg',
      data: cameraFrameBase64
    }
  });

  const prompt = `
    Analyze the last image (the camera frame) and compare it against the preceding images (the employee database).
    
    The preceding images correspond to these IDs in order:
    ${gallery.map(e => e.id).join(', ')}
    
    Task:
    1. Identify if the person in the last image matches ANY of the people in the preceding images.
    2. STRICT MATCHING: The faces must be very similar (same person).
    3. Return the ID of the matched person.
    4. If no match is found, return "null" (string).
    
    Output strictly in JSON format: { "matchedId": "string_id_or_null" }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', 
      // Correcting contents structure to match recommended multi-part style
      contents: { parts: [...galleryParts, { text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1, // Low temp for precision
      }
    });

    // Accessing text as a property
    const text = response.text;
    if (!text) return null;
    
    try {
      const json = JSON.parse(text);
      return (json.matchedId && json.matchedId !== 'null') ? json.matchedId : null;
    } catch (e) {
      console.error("JSON Parse error", e);
      return null;
    }

  } catch (error) {
    // console.error("Gemini Identification Error:", error);
    return null;
  }
};

export const generateTelegramReport = async (logs: AttendanceLog[]): Promise<string> => {
  if (logs.length === 0) return "Нет данных о посещаемости за сегодня.";

  // Initialize AI client inside the function to ensure up-to-date API key usage.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Analyze these attendance logs and write a short, professional summary for a manager (in Russian).
    
    Logs:
    ${JSON.stringify(logs.map(l => ({ name: l.employeeName, time: l.timestamp, type: l.type })))}
    
    Include:
    1. Total unique employees present.
    2. Who arrived late (after 9:00 AM) if any.
    3. Any anomalies (e.g., exit without entry).
    4. Keep it concise (max 3-4 sentences).
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      // Simple text contents
      contents: prompt
    });
    // Accessing text as a property
    return response.text || "Отчет сформирован.";
  } catch (e) {
    return "Ошибка генерации AI отчета.";
  }
};
