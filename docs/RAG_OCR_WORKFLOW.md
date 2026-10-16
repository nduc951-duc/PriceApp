# OCR review workflow

The 13 source photos live in `frontend/public/source-pages/page-01.jpg` through `page-13.jpg`.

Any signed-in user can open `/rag-admin`, scan a selected page with Ollama `glm-ocr`, edit the returned chunks, and save the transcription as a draft. Only owners can approve or reject a page, attach verified product variants, inspect RAG administration, or rebuild embeddings. OCR and draft saving never approve or index content automatically.

The page viewer and OCR scanner use the bundled image first, then request a short-lived Supabase Storage URL when that local image is unavailable. Saving drafts requires the `202610160001_rag_ocr_for_authenticated_users.sql` migration.

Configure `RAG_OCR_MODEL=glm-ocr` in the backend environment. Install it on the Ollama host with:

```sh
ollama pull glm-ocr
```

OCR quality depends on handwriting, focus, lighting, and perspective. A local check of page 1 returned in about 15 seconds with GLM-OCR, but several Vietnamese labels and price values were incorrect. Cropping the left table reduced the response to about 10 seconds and improved row separation, but did not make the values reliable. A full-page Qwen3-VL 8B request did not finish within the 240-second test limit on the checked machine, so there is no verified accuracy comparison for that model here.

Treat every OCR result as untrusted transcription. The interface saves it only as a draft; compare each SKU, unit, and price with the original photo before approval or indexing. The 13 source images are handwritten photographs, so a model result must not be presented as verified pricing.
