const express = require("express");

const {
  PREVIEW_CONTENT_TYPE,
  getVoicePreview,
  issueVoicePreviewToken,
  resolveVoicePreviewToken
} = require("../voices/preview");

const router = express.Router();

router.post("/preview", async (req, res) => {
  try {
    const result = await getVoicePreview(req.body?.voiceId, req.body?.sampleKey);
    if (result.error) return res.status(result.status).json({ code: result.error, error: "Voice preview unavailable." });
    const token = issueVoicePreviewToken(req.body.voiceId, req.body.sampleKey);
    return res.status(200).json({ previewUrl: `/api/v1/voices/preview/${token}` });
  } catch (error) {
    console.error("[VoicePreview] generation failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return res.status(502).json({ code: "preview_unavailable", error: "Voice preview unavailable." });
  }
});

router.get("/preview/:token", async (req, res) => {
  try {
    const preview = resolveVoicePreviewToken(req.params.token);
    if (!preview) return res.status(404).json({ code: "preview_expired", error: "Voice preview unavailable." });
    const result = await getVoicePreview(preview.voiceId, preview.sampleKey);
    res.set({
      "Cache-Control": "private, max-age=86400",
      "Content-Type": PREVIEW_CONTENT_TYPE,
      "X-Speak-Preview-Cache": result.cache
    });
    return res.status(200).send(result.audio);
  } catch (error) {
    console.error("[VoicePreview] playback failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return res.status(502).json({ code: "preview_unavailable", error: "Voice preview unavailable." });
  }
});

module.exports = router;
