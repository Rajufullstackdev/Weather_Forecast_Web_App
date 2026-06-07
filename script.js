"use strict";

// ── Constants ───────────────────────────────────────────────-
let WEATHERAPI_KEY =
  localStorage.getItem("WEATHERAPI_KEY") || "8b565770803a42cda0c71715260706";
const BASE_WEATHERAPI = "https://api.weatherapi.com/v1";
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

// ── DOM Refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {
  input: $("location-input"),
  searchBtn: $("search-btn"),
  gpsBtn: $("gps-btn"),
  idle: $("idle-state"),
  loading: $("loading-state"),
  error: $("error-state"),
  errorMsg: $("error-msg"),
  retryBtn: $("retry-btn"),
  display: $("weather-display"),
  clock: $("clock"),
  // weather fields
  cityName: $("city-name"),
  countryName: $("country-name"),
  emoji: $("weather-emoji"),
  temp: $("temp-value"),
  condition: $("condition-text"),
  feelsLike: $("feels-like"),
  humidity: $("humidity-val"),
  wind: $("wind-val"),
  uv: $("uv-val"),
  vis: $("vis-val"),
  pressure: $("pressure-val"),
  forecast: $("forecast-strip"),
  hourly: $("hourly-strip"),
  sunrise: $("sunrise-val"),
  sunset: $("sunset-val"),
  // api key modal
  apiKeyModal: $("api-key-modal"),
  apiKeyInput: $("api-key-input"),
  apiKeySave: $("api-key-save"),
  apiKeyCancel: $("api-key-cancel"),
  apiKeyMsg: $("api-key-msg"),
};

function promptForApiKey(message) {
  return new Promise((resolve, reject) => {
    if (!dom.apiKeyModal) return reject(new Error("Modal elements missing"));
    dom.apiKeyMsg.textContent = message || dom.apiKeyMsg.textContent;
    dom.apiKeyInput.value = "";
    dom.apiKeyModal.classList.remove("hidden");

    function cleanup() {
      dom.apiKeySave.removeEventListener("click", onSave);
      dom.apiKeyCancel.removeEventListener("click", onCancel);
      dom.apiKeyModal.classList.add("hidden");
    }

    function onSave() {
      const val = dom.apiKeyInput.value.trim();
      cleanup();
      if (val) resolve(val);
      else reject(new Error("No API key provided"));
    }

    function onCancel() {
      cleanup();
      reject(new Error("User cancelled"));
    }

    dom.apiKeySave.addEventListener("click", onSave);
    dom.apiKeyCancel.addEventListener("click", onCancel);
    dom.apiKeyInput.focus();
  });
}

// ── Clock ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  dom.clock.textContent = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
setInterval(updateClock, 1000);
updateClock();

// ── Stars Canvas ──────────────────────────────────────────────
(function initStars() {
  const canvas = $("stars");
  const ctx = canvas.getContext("2d");
  let stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    generateStars();
  }

  function generateStars() {
    const count = Math.floor((canvas.width * canvas.height) / 6000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      o: Math.random() * 0.7 + 0.3,
      spd: Math.random() * 0.008 + 0.002,
      t: Math.random() * Math.PI * 2,
    }));
  }

  function drawStars(ts) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach((s) => {
      s.t += s.spd;
      const opacity = s.o * (0.6 + 0.4 * Math.sin(s.t));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,230,255,${opacity})`;
      ctx.fill();
    });
    requestAnimationFrame(drawStars);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(drawStars);
})();

// ── State Management ──────────────────────────────────────────
let lastQuery = "";

function showState(state) {
  ["idle", "loading", "error", "display"].forEach((s) => {
    const el = dom[s === "display" ? "display" : s];
    if (el) el.classList.add("hidden");
  });
  const target = {
    idle: dom.idle,
    loading: dom.loading,
    error: dom.error,
    display: dom.display,
  }[state];
  if (target) target.classList.remove("hidden");
}

function getWeatherEmoji(icon) {
  const code = icon.slice(0, 2);
  switch (code) {
    case "01":
      return icon.endsWith("n") ? "🌙" : "☀️";
    case "02":
      return "⛅";
    case "03":
    case "04":
      return "☁️";
    case "09":
      return "🌧️";
    case "10":
      return "🌦️";
    case "11":
      return "⛈️";
    case "13":
      return "❄️";
    case "50":
      return "🌫️";
    default:
      return "🌈";
  }
}

function formatTime(dt, tzOffset) {
  const date = new Date((dt + tzOffset) * 1000);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDay(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
  });
}

async function performFetchWithKeyRetry(url) {
  let response = await fetch(url);
  if (response.ok) return response;

  if (response.status === 401 || response.status === 403) {
    try {
      const newKey = await promptForApiKey(
        "WeatherAPI key invalid or blocked. Paste a valid WeatherAPI key to continue.",
      );
      localStorage.setItem("WEATHERAPI_KEY", newKey);
      const retryUrl = url.replace(/key=[^&]*/, `key=${newKey}`);
      response = await fetch(retryUrl);
      return response;
    } catch (err) {
      throw new Error("Invalid API key");
    }
  }

  return response;
}

function formatHourString(hourText) {
  const [time, modifier] = hourText.split(" ");
  if (!modifier) return hourText;
  let [h, m] = time.split(":").map(Number);
  if (modifier.toUpperCase() === "PM" && h !== 12) h += 12;
  if (modifier.toUpperCase() === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function mapWeatherEmoji(conditionText, isDay) {
  const text = conditionText.toLowerCase();
  if (text.includes("sunny") || text.includes("clear"))
    return isDay ? "☀️" : "🌙";
  if (text.includes("cloud")) return "⛅";
  if (text.includes("rain") || text.includes("drizzle")) return "🌧️";
  if (text.includes("thunder")) return "⛈️";
  if (text.includes("snow") || text.includes("sleet")) return "❄️";
  if (text.includes("mist") || text.includes("fog") || text.includes("haze"))
    return "🌫️";
  return isDay ? "🌤️" : "🌙";
}

async function fetchWeatherData(query) {
  const locationMatch = query.match(
    /latitude\s*([+-]?[0-9]+(?:\.[0-9]+)?),\s*longitude\s*([+-]?[0-9]+(?:\.[0-9]+)?)/i,
  );

  const q = locationMatch ? `${locationMatch[1]},${locationMatch[2]}` : query;

  const url = `${BASE_WEATHERAPI}/forecast.json?key=${WEATHERAPI_KEY}&q=${encodeURIComponent(
    q,
  )}&days=6&aqi=no&alerts=no`;

  const response = await performFetchWithKeyRetry(url);
  const data = await response.json();

  if (data.error) {
    if (data.error.code === 1006 || data.error.code === 1003) {
      throw new Error("Location not found");
    }
    if (data.error.code === 1005 || data.error.code === 2006) {
      throw new Error("Invalid API key");
    }
    throw new Error(data.error.message || "Weather API error");
  }

  return data;
}

async function fetchWeather(queryOverride) {
  const query = (queryOverride || dom.input.value).trim();
  if (!query) {
    dom.input.focus();
    return;
  }

  lastQuery = query;
  dom.input.value = query;
  showState("loading");

  try {
    const apiData = await fetchWeatherData(query);
    const today = apiData.forecast.forecastday[0];

    const weather = {
      location: apiData.location.name,
      country: apiData.location.country,
      temp: apiData.current.temp_c,
      feels_like: apiData.current.feelslike_c,
      condition: apiData.current.condition.text,
      emoji: mapWeatherEmoji(
        apiData.current.condition.text,
        apiData.current.is_day === 1,
      ),
      humidity: apiData.current.humidity,
      wind_kph: apiData.current.wind_kph,
      uv_index: Math.round(apiData.current.uv),
      visibility_km: apiData.current.vis_km,
      pressure_hpa: apiData.current.pressure_mb,
      sunrise: formatHourString(today.astro.sunrise),
      sunset: formatHourString(today.astro.sunset),
      forecast: apiData.forecast.forecastday.slice(1, 6).map((day) => ({
        day: formatDay(day.date),
        hi: day.day.maxtemp_c,
        lo: day.day.mintemp_c,
        emoji: mapWeatherEmoji(day.day.condition.text, true),
        condition: day.day.condition.text,
      })),
      hourly: today.hour.slice(0, 9).map((hour, index) => ({
        hour:
          index === 0
            ? "Now"
            : formatHourString(hour.time.split(" ")[1] || hour.time),
        temp: hour.temp_c,
        emoji: mapWeatherEmoji(hour.condition.text, hour.is_day === 1),
      })),
    };

    renderWeather(weather);
  } catch (err) {
    console.error(err);
    dom.errorMsg.textContent =
      err.message === "Location not found"
        ? "City not found. Please try a different name."
        : "Could not load weather data. Please check your connection and try again.";
    showState("error");
  }
}

// ── Render Weather ────────────────────────────────────────────
function renderWeather(wx) {
  // Hero
  dom.cityName.textContent = wx.location;
  dom.countryName.textContent = wx.country;
  dom.emoji.textContent = wx.emoji;
  dom.temp.textContent = Math.round(wx.temp);
  dom.condition.textContent = wx.condition;
  dom.feelsLike.textContent = `Feels like ${Math.round(wx.feels_like)}°C`;

  // Stats
  dom.humidity.textContent = `${wx.humidity}%`;
  dom.wind.textContent = Math.round(wx.wind_kph);
  dom.uv.textContent = wx.uv_index;
  dom.vis.textContent = `${Math.round(wx.visibility_km)} km`;
  dom.pressure.textContent = wx.pressure_hpa;

  // UV colour indicator
  const uvEl = $("uv-val");
  if (wx.uv_index <= 2) uvEl.style.color = "#86efac";
  else if (wx.uv_index <= 5) uvEl.style.color = "#fcd34d";
  else if (wx.uv_index <= 7) uvEl.style.color = "#fb923c";
  else uvEl.style.color = "#fb7185";

  // Forecast
  dom.forecast.innerHTML = wx.forecast
    .map(
      (d) => `
    <div class="fc-card">
      <span class="fc-day">${d.day}</span>
      <span class="fc-emoji">${d.emoji}</span>
      <span class="fc-hi">${Math.round(d.hi)}°</span>
      <span class="fc-lo">${Math.round(d.lo)}°</span>
    </div>
  `,
    )
    .join("");

  // Hourly — mark first slot as "now"
  dom.hourly.innerHTML = wx.hourly
    .map(
      (h, i) => `
    <div class="hr-card ${i === 0 ? "now" : ""}">
      <span class="hr-time">${i === 0 ? "Now" : h.hour}</span>
      <span class="hr-emoji">${h.emoji}</span>
      <span class="hr-temp">${Math.round(h.temp)}°</span>
    </div>
  `,
    )
    .join("");

  // Sunrise / Sunset
  dom.sunrise.textContent = wx.sunrise;
  dom.sunset.textContent = wx.sunset;
  drawSunArc(wx.sunrise, wx.sunset);

  showState("display");
}

// ── Sun Arc Canvas ────────────────────────────────────────────
function drawSunArc(sunrise, sunset) {
  const canvas = $("sun-arc");
  const ctx = canvas.getContext("2d");
  const W = canvas.width,
    H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const cx = W / 2,
    cy = H + 10;
  const r = H + 10;

  // Parse times
  const parseTime = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h + m / 60;
  };

  const now = new Date().getHours() + new Date().getMinutes() / 60;
  const srTime = parseTime(sunrise);
  const ssTime = parseTime(sunset);
  const dayLen = ssTime - srTime;
  const prog = Math.min(1, Math.max(0, (now - srTime) / dayLen));

  // Arc angles: start = left (sunrise), end = right (sunset)
  const startAngle = Math.PI;
  const endAngle = 0;

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0, false);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Progress arc
  const progressAngle =
    startAngle + (endAngle - startAngle + Math.PI) * (1 - prog);
  const gradient = ctx.createLinearGradient(0, 0, W, 0);
  gradient.addColorStop(0, "rgba(251,191,36,0.9)");
  gradient.addColorStop(1, "rgba(251,113,133,0.4)");

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, progressAngle, false);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();

  // Sun dot position
  const angle = Math.PI + Math.PI * prog;
  const sx = cx + r * Math.cos(angle);
  const sy = cy + r * Math.sin(angle);

  // Glow
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 18);
  glow.addColorStop(0, "rgba(251,191,36,0.8)");
  glow.addColorStop(1, "rgba(251,191,36,0)");
  ctx.beginPath();
  ctx.arc(sx, sy, 18, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Sun circle
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#fbbf24";
  ctx.fill();

  // Sunrise / sunset dots
  [
    { t: 0, label: sunrise },
    { t: 1, label: sunset },
  ].forEach(({ t }) => {
    const a = Math.PI + Math.PI * t;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fill();
  });
}

// ── Geolocation ───────────────────────────────────────────────
function getLocation() {
  if (!navigator.geolocation) {
    dom.errorMsg.textContent = "Geolocation is not supported by your browser.";
    showState("error");
    return;
  }

  showState("loading");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const q = `latitude ${latitude.toFixed(4)}, longitude ${longitude.toFixed(4)}`;
      dom.input.value = "Detecting location…";
      fetchWeather(q);
    },
    () => {
      dom.errorMsg.textContent =
        "Location permission denied. Please enter a city manually.";
      showState("error");
    },
  );
}

// ── Event Listeners ───────────────────────────────────────────
dom.searchBtn.addEventListener("click", () => fetchWeather());
dom.gpsBtn.addEventListener("click", getLocation);
dom.retryBtn.addEventListener("click", () => fetchWeather(lastQuery));

dom.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchWeather();
});

// Quick city buttons
document.querySelectorAll(".quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const city = btn.dataset.city;
    dom.input.value = city;
    fetchWeather(city);
  });
});

// ── Init ──────────────────────────────────────────────────────
showState("idle");
