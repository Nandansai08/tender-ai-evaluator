"""Image / scanned-document parser using Tesseract OCR via pytesseract."""
import io
from pathlib import Path


def ocr_image_bytes(image_bytes: bytes, lang: str = "eng") -> str:
    """
    Run Tesseract OCR on raw image bytes and return extracted text.

    Args:
        image_bytes: Raw bytes of the image (PNG, JPEG, TIFF, etc.)
        lang: Tesseract language code.  Default is "eng".

    Returns:
        Extracted text string, or empty string on failure.
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return ""

    try:
        image = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(image, lang=lang)
        return text.strip()
    except Exception:
        return ""


def parse_image(file_path: str, lang: str = "eng") -> dict:
    """
    Parse an image file (photograph, scanned certificate, etc.) using OCR.

    Supported formats: JPEG, PNG, TIFF, BMP, GIF.

    Returns:
        dict with keys: text, confidence_hint, error
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return {
            "text": "",
            "confidence_hint": 0.0,
            "error": "pytesseract or Pillow not installed.",
        }

    try:
        image = Image.open(file_path)
    except Exception as exc:
        return {"text": "", "confidence_hint": 0.0, "error": str(exc)}

    try:
        # Get detailed OCR data including confidence scores
        data = pytesseract.image_to_data(
            image, lang=lang, output_type=pytesseract.Output.DICT
        )
        words = []
        confidences = []
        for i, word in enumerate(data["text"]):
            conf = int(data["conf"][i])
            if conf > 0 and word.strip():
                words.append(word)
                confidences.append(conf)

        text = pytesseract.image_to_string(image, lang=lang).strip()
        avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

        return {
            "text": text,
            "confidence_hint": round(avg_confidence, 3),
            "error": None,
        }
    except Exception as exc:
        return {"text": "", "confidence_hint": 0.0, "error": str(exc)}
