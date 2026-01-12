/**
 * Converts a hex color to RGB object.
 */
function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Converts RGB to Hex.
 */
function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Converts RGB to HSL.
 */
function rgbToHsl(r, g, b) {
  r /= 255, g /= 255, b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

/**
 * Converts HSL to RGB.
 */
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

/**
 * Calculates the relative luminance of a color.
 */
function getLuminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Calculates contrast ratio between two luminances.
 */
function getContrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Extracts the dominant color from an image element.
 */
export async function getDominantColor(img) {
  return new Promise((resolve, reject) => {
    if (!img.complete) {
       return reject("Image not loaded");
    }
    
    try {
      const canvas = document.createElement('canvas');
      // Re-draw a bit larger
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 50, 50);
      const data = ctx.getImageData(0, 0, 50, 50).data;
      
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const tr = data[i];
        const tg = data[i+1];
        const tb = data[i+2];
        const ta = data[i+3];
        
        if (ta < 128) continue; // Skip transparent
        
        const max = Math.max(tr, tg, tb);
        const min = Math.min(tr, tg, tb);
        if ((max - min) < 20) continue; // Skip gray/black/white
        
        r += tr;
        g += tg;
        b += tb;
        count++;
      }
      
      if (count === 0) {
          const p1 = ctx.getImageData(0, 0, 1, 1).data;
          resolve(rgbToHex(p1[0], p1[1], p1[2]));
          return;
      }
      
      resolve(rgbToHex(Math.round(r/count), Math.round(g/count), Math.round(b/count)));
    } catch (e) {
      reject(e); // Likely CORS
    }
  });
}

/**
 * Adjusts a foreground color to ensure sufficient contrast against a background.
 * Uses HSL adjustment for better color preservation.
 * @param {string} fgHex - Foreground color.
 * @param {boolean} isDark - Whether the theme is dark mode.
 */
export function ensureContrast(fgHex, isDark) {
  const rgb = hexToRgb(fgHex);
  if (!rgb) return fgHex;
  
  // Target background luminance
  // Dark mode bg ~ #000000 (after update) -> Lum 0.0
  // Light mode bg ~ #ffffff (after update) -> Lum 1.0
  // Use slightly off-values to be safe
  const bgLum = isDark ? 0.0 : 1.0;
  
  let [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  
  // Limit iterations
  for (let i = 0; i < 20; i++) {
    const curRgb = hslToRgb(h, s, l);
    const lum = getLuminance(curRgb.r, curRgb.g, curRgb.b);
    const ratio = getContrastRatio(lum, bgLum);
    
    if (ratio >= 4.5) return rgbToHex(curRgb.r, curRgb.g, curRgb.b);
    
    // Adjust
    if (isDark) {
      // Lighten
      l = Math.min(1, l + 0.05);
    } else {
      // Darken
      l = Math.max(0, l - 0.05);
    }
  }
  
  const finalRgb = hslToRgb(h, s, l);
  return rgbToHex(finalRgb.r, finalRgb.g, finalRgb.b);
}