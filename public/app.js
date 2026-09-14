const state = {
  idToken: null,
  latitude: null,
  longitude: null,
  initialized: false,
  map: null,
  mapMarker: null,
  maxUploadFiles: 5,
  maxFileMb: 10,
  selectedUploadFiles: [],
  previewUrls: [],
  lineProfile: null,
  devBypassLineAuth: false,
};

const statusLabels = {
  new: 'รับเรื่องใหม่',
  received: 'รับเรื่องแล้ว',
  assigned: 'มอบหมายหน่วยงานแล้ว',
  in_progress: 'กำลังดำเนินการ',
  waiting_for_info: 'รอข้อมูลเพิ่มเติม',
  completed: 'ดำเนินการเสร็จสิ้น',
  rejected: 'ไม่รับดำเนินการ',
  cancelled: 'ยกเลิก',
};

const $ = (selector) => document.querySelector(selector);
const lineReloginStorageKey = 'lineReloginRequestedAt';
const lineReloginCooldownMs = 60_000;

function getLineLoginRedirectUri() {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function requestLineRelogin() {
  if (state.devBypassLineAuth || !window.liff?.login) return false;

  const now = Date.now();
  const lastRequestedAt = Number(sessionStorage.getItem(lineReloginStorageKey) || 0);

  if (now - lastRequestedAt < lineReloginCooldownMs) return false;

  sessionStorage.setItem(lineReloginStorageKey, String(now));
  state.idToken = null;
  state.initialized = false;
  showAlert('เซสชัน LINE หมดอายุ กำลังเข้าสู่ระบบใหม่…');

  try {
    if (window.liff.isLoggedIn()) window.liff.logout();
  } catch (error) {
    console.warn('LINE logout before re-login failed', error);
  }

  window.setTimeout(() => {
    window.liff.login({ redirectUri: getLineLoginRedirectUri() });
  }, 150);

  return true;
}

function openImageViewer(src, caption = 'รูปภาพประกอบ') {
  const dialog = $('#imageViewer');
  const image = $('#imageViewerImage');
  image.src = src;
  image.alt = caption;
  $('#imageViewerCaption').textContent = caption;
  if (!dialog.open) dialog.showModal();
}

function setupImageViewer() {
  const dialog = $('#imageViewer');
  const close = () => dialog.close();
  $('#imageViewerClose').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside || event.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    $('#imageViewerImage').removeAttribute('src');
  });
}

// ชื่อช่องกรอกเป็นภาษาไทย สำหรับแปลรายละเอียดข้อผิดพลาดจากเซิร์ฟเวอร์
const validationFieldLabels = {
  categoryId: 'หมวดหมู่',
  title: 'หัวข้อ',
  description: 'รายละเอียด',
  locationText: 'สถานที่เกิดเหตุ',
  latitude: 'ละติจูด',
  longitude: 'ลองจิจูด',
  contactName: 'ชื่อผู้ติดต่อ',
  contactPhone: 'เบอร์โทรศัพท์',
  contactEmail: 'อีเมล',
  privacyConsent: 'การยอมรับประกาศความเป็นส่วนตัว',
};

// แปลง zod flatten ({ formErrors, fieldErrors }) เป็นข้อความไทยที่อ่านรู้เรื่อง
function describeValidationDetails(details) {
  if (!details || typeof details !== 'object') return '';

  const messages = [];

  for (const [field, errors] of Object.entries(details.fieldErrors || {})) {
    const reason = (errors || []).filter(Boolean).join(' / ');
    if (!reason) continue;
    messages.push(`${validationFieldLabels[field] || field}: ${reason}`);
  }

  for (const formError of details.formErrors || []) {
    if (formError) messages.push(formError);
  }

  return messages.join(' • ');
}

function showAlert(message, type = 'error') {
  const alert = $('#alert');
  alert.textContent = message;
  alert.className = `alert ${type}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearAlert() {
  $('#alert').className = 'alert hidden';
  $('#alert').textContent = '';
}

function restoreLineContactName() {
  const contactName = $('#contactName');
  if (!contactName) return;

  const displayName = state.lineProfile?.displayName || '';

  if (displayName) contactName.value = displayName;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;

  if (!isFormData) headers.set('content-type', 'application/json');
  if (state.idToken) {
    headers.set('authorization', `Bearer ${state.idToken}`);
  }

  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json')
    ? await response.json()
    : await response.blob();

  if (!response.ok) {
    const baseMessage =
      result && typeof result === 'object' && 'message' in result
        ? result.message
        : `เกิดข้อผิดพลาด ${response.status}`;
    // เซิร์ฟเวอร์ส่งรายละเอียดว่าช่องไหนผิดมาใน details แต่เดิมถูกทิ้งไป
    // ผู้ใช้จึงเห็นแค่ "ข้อมูลไม่ถูกต้อง" โดยไม่รู้ว่าต้องแก้ตรงไหน
    const detailText = describeValidationDetails(result?.details);
    const message = detailText ? `${baseMessage} — ${detailText}` : baseMessage;

    if (response.status === 401 && !state.devBypassLineAuth) {
      const isRedirecting = requestLineRelogin();
      throw new Error(
        isRedirecting
          ? 'เซสชัน LINE หมดอายุ กำลังเข้าสู่ระบบใหม่…'
          : `${message} กรุณาปิดหน้านี้แล้วเปิดจาก LINE อีกครั้ง`,
      );
    }

    throw new Error(message);
  }

  if (state.idToken && path.startsWith('/api/complaints')) {
    sessionStorage.removeItem(lineReloginStorageKey);
  }

  return result;
}

async function initializeLiff() {
  const greeting = $('#userGreeting');
  const setLineStatus = (message) => {
    if (greeting) greeting.textContent = message;
  };

  try {
    setLineStatus('กำลังโหลดการตั้งค่า LINE…');

    const configResponse = await fetch('/api/config', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    if (!configResponse.ok) {
      throw new Error(`CONFIG_HTTP_${configResponse.status}`);
    }

    const config = await configResponse.json();
    state.maxUploadFiles = config.uploadLimits?.maxFiles || 5;
    state.maxFileMb = config.uploadLimits?.maxFileMb || 10;

    $('#privacyLink').href = config.privacyPolicyUrl || '/privacy.html';
    $('#imageHelp').textContent =
      `แนบ 1–${state.maxUploadFiles} ภาพ ภาพละไม่เกิน ${state.maxFileMb} MB ` +
      'ระบบจะลบข้อมูล EXIF และย่อขนาดก่อนจัดเก็บ';

    if (config.devBypassLineAuth) {
      state.devBypassLineAuth = true;
      const contactName = $('#contactName');
      contactName.readOnly = false;
      contactName.value = '';
      setLineStatus('โหมดทดสอบ Local — ไม่บันทึกข้อมูล LINE');
      $('#successNotice').textContent =
        'รายการนี้เป็นข้อมูลทดสอบ Local และจะไม่มีการแจ้งเตือนผ่าน LINE OA';
      $('#historyDescription').textContent =
        'ตรวจสอบเรื่องร้องเรียนที่สร้างในโหมดทดสอบ Local';
      state.initialized = true;
      return true;
    }

    if (!config.liffId) throw new Error('LIFF_ID_MISSING');
    if (!window.liff) throw new Error('LIFF_SDK_NOT_LOADED');

    setLineStatus('กำลังเริ่มต้น LINE LIFF…');
    await Promise.race([
      window.liff.init({ liffId: config.liffId }),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('LIFF_INIT_TIMEOUT')), 20000);
      }),
    ]);

    if (!window.liff.isLoggedIn()) {
      setLineStatus('กำลังเข้าสู่ระบบ LINE…');
      window.liff.login({ redirectUri: getLineLoginRedirectUri() });
      return false;
    }

    state.idToken = window.liff.getIDToken();
    if (!state.idToken) throw new Error('ID_TOKEN_MISSING_OPENID_SCOPE');

    const decodedToken = window.liff.getDecodedIDToken?.();
    if (decodedToken?.exp && decodedToken.exp * 1000 <= Date.now() + 30_000) {
      requestLineRelogin();
      return false;
    }

    setLineStatus('กำลังโหลดข้อมูลผู้ใช้ LINE…');
    const profile = await window.liff.getProfile();
    state.lineProfile = profile;

    setLineStatus(`สวัสดี ${profile.displayName || 'ผู้ใช้ LINE'}`);
    restoreLineContactName();

    const profileImage = $('#lineProfileImage');
    const fallbackIcon = $('#lineFallbackIcon');

    async function showLineProfileImage(pictureUrl) {
      if (!profileImage || !pictureUrl) return false;

      const proxiedUrl = `/api/line/profile-image?url=${encodeURIComponent(pictureUrl)}`;
      const candidateUrls = [proxiedUrl, pictureUrl];

      for (const imageUrl of candidateUrls) {
        try {
          const preload = new Image();
          preload.decoding = 'async';
          preload.referrerPolicy = 'no-referrer';

          await new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('PROFILE_IMAGE_TIMEOUT')), 10000);
            preload.onload = () => {
              window.clearTimeout(timer);
              resolve();
            };
            preload.onerror = () => {
              window.clearTimeout(timer);
              reject(new Error('PROFILE_IMAGE_LOAD_FAILED'));
            };
            preload.src = imageUrl;
          });

          profileImage.alt = `รูปโปรไฟล์ของ ${profile.displayName || 'ผู้ใช้ LINE'}`;
          profileImage.referrerPolicy = 'no-referrer';
          profileImage.src = imageUrl;
          profileImage.classList.remove('hidden');
          fallbackIcon?.classList.add('hidden');
          return true;
        } catch (error) {
          console.warn('ลองโหลดรูปโปรไฟล์ LINE ไม่สำเร็จ', { imageUrl, error: error.message });
        }
      }

      return false;
    }

    profileImage?.removeAttribute('src');
    profileImage?.classList.add('hidden');
    fallbackIcon?.classList.remove('hidden');

    if (profile.pictureUrl) {
      const loaded = await showLineProfileImage(profile.pictureUrl);
      if (!loaded) console.warn('โหลดรูปโปรไฟล์ LINE ไม่สำเร็จทุกวิธี', profile.pictureUrl);
    }

    state.initialized = true;
    return true;
  } catch (error) {
    const code = error?.code || error?.message || 'UNKNOWN_LINE_ERROR';
    console.error('LINE LIFF connection failed', {
      code: error?.code,
      message: error?.message,
      currentUrl: window.location.href,
      isInClient: Boolean(window.liff?.isInClient?.()),
      isLoggedIn: Boolean(window.liff?.isLoggedIn?.()),
    });
    setLineStatus(`LINE ผิดพลาด: ${code}`);
    throw new Error(`เชื่อมต่อ LINE ไม่สำเร็จ (${code})`);
  }
}

async function loadCategories() {
  const result = await api('/api/categories');
  const select = $('#categoryId');
  select.replaceChildren(new Option('เลือกหมวดหมู่', ''));

  for (const category of result.data) {
    select.append(new Option(category.name_th, category.id));
  }
}

function formatThaiDate(value) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

// วันครบกำหนดแสดงแค่วัน เดือน ปี ไม่ต้องมีเวลา
function formatThaiDateOnly(value) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'long',
  }).format(new Date(value));
}

function openStreetMapUrl(latitude, longitude) {
  const lat = Number(latitude).toFixed(6);
  const lng = Number(longitude).toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=18/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
}

function ensureMap() {
  if (state.map) return state.map;

  if (typeof L === 'undefined') {
    throw new Error('ไม่สามารถโหลดระบบแผนที่ OpenStreetMap ได้');
  }

  const mapElement = $('#mapView');
  if (!mapElement) {
    throw new Error('ไม่พบพื้นที่แสดงแผนที่');
  }

  state.map = L.map(mapElement, {
    zoomControl: true,
    attributionControl: true,
    tap: true,
    touchZoom: true,
    dragging: true,
    doubleClickZoom: true,
    scrollWheelZoom: true,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);

  // แสดงสุราษฎร์ธานีทันที แม้ยังไม่ได้อนุญาตตำแหน่ง
  state.map.setView([9.1382, 99.3217], 13);

  const pinFromEvent = (event) => {
    if (!event?.latlng) return;
    setCoordinates(event.latlng.lat, event.latlng.lng);
  };

  state.map.on('click', pinFromEvent);

  // ปุ่มสำรองสำหรับมือถือ/LINE WebView ที่ event click อาจไม่ทำงานบางรุ่น
  mapElement.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerType !== 'touch') return;
      if (event.target?.closest?.('.leaflet-control, .leaflet-marker-icon')) return;

      const rect = mapElement.getBoundingClientRect();
      const point = L.point(event.clientX - rect.left, event.clientY - rect.top);
      const latLng = state.map.containerPointToLatLng(point);
      setCoordinates(latLng.lat, latLng.lng);
    },
    { passive: true },
  );

  window.setTimeout(() => state.map.invalidateSize(true), 100);
  return state.map;
}
function renderMap(latitude, longitude) {
  const panel = $('#mapPanel');
  const link = $('#openMap');
  const map = ensureMap();
  const latLng = [latitude, longitude];

  link.href = openStreetMapUrl(latitude, longitude);
  panel.classList.remove('hidden');

  if (!state.mapMarker) {
    state.mapMarker = L.marker(latLng, { draggable: true }).addTo(map);
    state.mapMarker.on('dragend', () => {
      const position = state.mapMarker.getLatLng();
      setCoordinates(position.lat, position.lng);
    });
  } else {
    state.mapMarker.setLatLng(latLng);
  }

  map.setView(latLng, 17);
  window.setTimeout(() => map.invalidateSize(), 0);
}

function setCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return false;
  }

  state.latitude = lat;
  state.longitude = lng;
  $('#latitude').value = lat.toFixed(6);
  $('#longitude').value = lng.toFixed(6);
  $('#locationStatus').textContent =
    `บันทึกพิกัดแล้ว (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
  renderMap(lat, lng);
  return true;
}

function syncManualCoordinates() {
  const lat = $('#latitude').value.trim();
  const lng = $('#longitude').value.trim();
  if (lat && lng) setCoordinates(lat, lng);
}

function clearImagePreviews() {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
  $('#imagePreview').replaceChildren();
}

function getUploadFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function renderSelectedImages() {
  clearAlert();
  clearImagePreviews();

  for (const file of state.selectedUploadFiles) {
    const url = URL.createObjectURL(file);
    state.previewUrls.push(url);

    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = url;
    image.alt = file.name;
    image.loading = 'lazy';
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `ดูรูป ${file.name}`);
    image.addEventListener('click', () => openImageViewer(url, file.name));
    image.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openImageViewer(url, file.name);
      }
    });

    // ปุ่มลบรูป เผื่อเลือกผิดใบจะได้เปลี่ยนได้โดยไม่ต้องกรอกฟอร์มใหม่
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'image-remove';
    removeButton.textContent = '✕';
    removeButton.title = `ลบรูป ${file.name}`;
    removeButton.setAttribute('aria-label', `ลบรูป ${file.name}`);
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      removeSelectedImage(file);
    });

    const caption = document.createElement('figcaption');
    caption.textContent = file.name;

    figure.append(image, removeButton, caption);
    $('#imagePreview').append(figure);
  }
}

function removeSelectedImage(target) {
  const targetKey = getUploadFileKey(target);
  state.selectedUploadFiles = state.selectedUploadFiles.filter(
    (file) => getUploadFileKey(file) !== targetKey,
  );
  renderSelectedImages();
  clearAlert();
}

function addSelectedImages(input) {
  const incomingFiles = [...input.files];
  input.value = '';
  if (!incomingFiles.length) return;

  const existingKeys = new Set(state.selectedUploadFiles.map(getUploadFileKey));
  const newFiles = incomingFiles.filter((file) => !existingKeys.has(getUploadFileKey(file)));
  const combinedFiles = [...state.selectedUploadFiles, ...newFiles];

  if (combinedFiles.length > state.maxUploadFiles) {
    showAlert(`แนบรูปภาพได้ไม่เกิน ${state.maxUploadFiles} ภาพ (เลือกไว้แล้ว ${state.selectedUploadFiles.length} ภาพ)`);
    return;
  }

  const oversizedFile = newFiles.find(
    (file) => file.size > state.maxFileMb * 1024 * 1024,
  );
  if (oversizedFile) {
    showAlert(`ไฟล์ “${oversizedFile.name}” ต้องไม่เกิน ${state.maxFileMb} MB`);
    return;
  }

  state.selectedUploadFiles = combinedFiles;
  renderSelectedImages();
  removeFieldError($('#images'));
}

async function loadProtectedGallery(container, attachments, urlBuilder, authToken) {
  if (!attachments?.length) return;

  container.innerHTML = '<p class="muted">กำลังโหลดรูปภาพ…</p>';
  const gallery = document.createElement('div');
  gallery.className = 'protected-gallery';

  try {
    for (const attachment of attachments) {
      const response = await fetch(urlBuilder(attachment), {
        headers: { authorization: `Bearer ${authToken}` },
      });

      if (response.status === 401 && !state.devBypassLineAuth) {
        const isRedirecting = requestLineRelogin();
        throw new Error(
          isRedirecting
            ? 'เซสชัน LINE หมดอายุ กำลังเข้าสู่ระบบใหม่…'
            : 'เซสชัน LINE ไม่ถูกต้อง กรุณาปิดหน้านี้แล้วเปิดจาก LINE อีกครั้ง',
        );
      }

      if (!response.ok) throw new Error('ไม่สามารถอ่านรูปภาพได้');

      sessionStorage.removeItem(lineReloginStorageKey);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const imageButton = document.createElement('button');
      imageButton.type = 'button';
      imageButton.className = 'image-thumbnail-button';
      imageButton.setAttribute('aria-label', `ดู${attachment.originalName || 'รูปภาพประกอบ'}`);

      const image = document.createElement('img');
      image.src = objectUrl;
      image.alt = attachment.originalName || 'รูปภาพประกอบ';
      image.loading = 'lazy';

      imageButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openImageViewer(objectUrl, image.alt);
      });
      imageButton.append(image);
      gallery.append(imageButton);
    }

    container.replaceChildren(gallery);
    return true;
  } catch (error) {
    container.innerHTML = `<p class="error-text">${error.message}</p>`;
    return false;
  }
}

function createComplaintTimeline(item) {
  const timeline = document.createElement('section');
  timeline.className = 'complaint-timeline';

  const title = document.createElement('h4');
  title.className = 'timeline-title';
  title.textContent = 'ไทม์ไลน์การดำเนินงาน';

  const timelineList = document.createElement('div');
  timelineList.className = 'timeline-list';

  const history =
    Array.isArray(item.history) && item.history.length
      ? item.history
      : [
          {
            new_status: item.status,
            note: null,
            created_at: item.updated_at || item.created_at,
          },
        ];

  const timelineEvents = history.map((event) => ({ ...event, attachments: [] }));
  const allAttachments = Array.isArray(item.attachments) ? item.attachments : [];
  const citizenAttachments = allAttachments.filter(
    (attachment) => attachment.source !== 'staff',
  );
  const staffAttachments = allAttachments.filter(
    (attachment) => attachment.source === 'staff',
  );

  if (timelineEvents.length && citizenAttachments.length) {
    timelineEvents[0].attachments.push(...citizenAttachments);
  }

  staffAttachments.forEach((attachment) => {
    const attachmentTime = new Date(attachment.createdAt).getTime();
    let closestIndex = timelineEvents.length - 1;
    let closestDifference = Number.POSITIVE_INFINITY;

    timelineEvents.forEach((event, index) => {
      const eventTime = new Date(event.created_at).getTime();
      if (!Number.isFinite(attachmentTime) || !Number.isFinite(eventTime)) return;
      const difference = Math.abs(eventTime - attachmentTime);
      if (difference < closestDifference) {
        closestDifference = difference;
        closestIndex = index;
      }
    });

    if (closestIndex >= 0) timelineEvents[closestIndex].attachments.push(attachment);
  });

  timelineEvents.forEach((event, index) => {
    const entry = document.createElement('div');
    entry.className = 'timeline-item';
    if (index === history.length - 1) entry.classList.add('timeline-current');

    const marker = document.createElement('span');
    marker.className = 'timeline-marker';
    marker.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'timeline-content';

    const heading = document.createElement('div');
    heading.className = 'timeline-heading';

    const status = document.createElement('strong');
    status.textContent =
      statusLabels[event.new_status] || event.new_status || 'อัปเดตสถานะ';

    const date = document.createElement('time');
    if (event.created_at) {
      date.dateTime = event.created_at;
      date.textContent = formatThaiDate(event.created_at);
    } else {
      date.textContent = '-';
    }

    heading.append(status, date);
    content.append(heading);

    if (event.note?.trim()) {
      const note = document.createElement('p');
      note.textContent = event.note.trim();
      content.append(note);
    }

    if (event.attachments.length) {
      const citizenImages = event.attachments.filter(
        (attachment) => attachment.source !== 'staff',
      );
      const staffImages = event.attachments.filter(
        (attachment) => attachment.source === 'staff',
      );

      for (const [attachments, label, isStaff] of [
        [citizenImages, 'รูปภาพจากผู้แจ้ง', false],
        [staffImages, 'รูปภาพผลการดำเนินงาน', true],
      ]) {
        if (!attachments.length) continue;
        const imageSection = document.createElement('section');
        imageSection.className = 'timeline-attachments';

        const imageHeading = document.createElement('strong');
        imageHeading.className = 'timeline-attachments-title';
        imageHeading.textContent = `${label} (${attachments.length})`;
        imageSection.append(imageHeading);

        if (isStaff) {
          const notes = [
            ...new Set(attachments.map((attachment) => attachment.staffNote).filter(Boolean)),
          ];
          if (notes.length) {
            const sourceNote = document.createElement('p');
            sourceNote.className = 'attachment-source-note';
            sourceNote.textContent = `หมายเหตุ: ${notes.join(' • ')}`;
            imageSection.append(sourceNote);
          }
        }

        const gallery = document.createElement('div');
        gallery.className = 'timeline-image-gallery';
        gallery.innerHTML = '<p class="muted">กำลังรอเปิดรายละเอียดเพื่อโหลดรูปภาพ…</p>';
        gallery.loadImages = async () => {
          if (gallery.dataset.loaded === 'true') return;
          gallery.dataset.loaded = 'true';
          const loaded = await loadProtectedGallery(
            gallery,
            attachments,
            (attachment) =>
              `/api/complaints/${encodeURIComponent(item.reference_no)}/attachments/${attachment.id}`,
            state.idToken,
          );
          if (!loaded) gallery.dataset.loaded = 'false';
        };
        imageSection.append(gallery);
        content.append(imageSection);
      }
    }

    entry.append(marker, content);
    timelineList.append(entry);
  });

  timeline.append(title, timelineList);
  return timeline;
}

async function loadComplaints() {
  const list = $('#complaintList');
  list.innerHTML = '<p class="muted">กำลังโหลดข้อมูล…</p>';

  try {
    const result = await api('/api/complaints');

    if (!result.data.length) {
      list.innerHTML = '<p class="empty">ยังไม่มีเรื่องร้องเรียน</p>';
      return;
    }

    list.replaceChildren();

    for (const item of result.data) {
      const article = document.createElement('article');
      article.className = 'complaint-card';
      article.tabIndex = 0;
      article.setAttribute('role', 'button');
      article.setAttribute('aria-expanded', 'false');

      const heading = document.createElement('div');
      heading.className = 'card-heading';

      const reference = document.createElement('strong');
      reference.textContent = item.reference_no;

      const badge = document.createElement('span');
      badge.className = `badge status-${item.status}`;
      badge.textContent = statusLabels[item.status] || item.status;

      heading.append(reference, badge);

      const title = document.createElement('h3');
      title.textContent = item.title;

      const category = document.createElement('p');
      category.textContent = `หมวดหมู่: ${item.category_name}`;

      const description = document.createElement('p');
      description.className = 'complaint-description';
      description.textContent = `รายละเอียด: ${item.description?.trim() || '-'}`;

      const location = document.createElement('p');
      location.textContent = `สถานที่: ${item.location_text?.trim() || '-'}`;

      const assignedStaff = document.createElement('p');
      if (item.assigned_staff_name) {
        // ชื่อกับตำแหน่งอยู่ด้วยกัน ส่วนช่องทางติดต่อคั่นด้วย |
        const nameBlock = item.assigned_staff_position
          ? `${item.assigned_staff_name} (${item.assigned_staff_position})`
          : item.assigned_staff_name;
        const parts = [nameBlock];
        if (item.assigned_staff_phone) parts.push(`เบอร์โทร ${item.assigned_staff_phone}`);
        if (item.assigned_staff_line_id) parts.push(`LINE ID ${item.assigned_staff_line_id}`);
        assignedStaff.textContent = `เจ้าหน้าที่ผู้รับผิดชอบ: ${parts.join(' | ')}`;
      } else {
        assignedStaff.textContent = 'เจ้าหน้าที่ผู้รับผิดชอบ: ยังไม่มอบหมาย';
      }

      const dueDate = document.createElement('p');
      if (item.due_at) {
        dueDate.textContent = `กำหนดแล้วเสร็จ: ${formatThaiDateOnly(item.due_at)}`;
      }

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      if (item.latitude !== null && item.longitude !== null) {
        const mapLink = document.createElement('a');
        mapLink.href = openStreetMapUrl(item.latitude, item.longitude);
        mapLink.target = '_blank';
        mapLink.rel = 'noopener';
        mapLink.className = 'secondary link-button';
        mapLink.textContent = 'เปิด OpenStreetMap';
        actions.append(mapLink);
      }

      const date = document.createElement('p');
      date.className = 'muted';
      date.textContent = `แจ้งเมื่อ ${formatThaiDate(item.created_at)}`;

      const timeline = createComplaintTimeline(item);

      const details = document.createElement('div');
      details.className = 'complaint-card-details hidden';
      details.id = `complaint-details-${String(item.id || item.reference_no).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      details.append(
        description,
        location,
        assignedStaff,
        dueDate,
        actions,
        timeline,
      );

      const toggleHint = document.createElement('small');
      toggleHint.className = 'complaint-toggle-hint';
      toggleHint.textContent = 'แตะเพื่อดูรายละเอียดและไทม์ไลน์';

      article.setAttribute('aria-controls', details.id);

      const toggleDetails = () => {
        const expanded = article.getAttribute('aria-expanded') === 'true';
        article.setAttribute('aria-expanded', String(!expanded));
        article.classList.toggle('complaint-card-expanded', !expanded);
        details.classList.toggle('hidden', expanded);
        if (!expanded) {
          details.querySelectorAll('.timeline-image-gallery').forEach((gallery) => {
            void gallery.loadImages?.();
          });
        }
        toggleHint.textContent = expanded
          ? 'แตะเพื่อดูรายละเอียดและไทม์ไลน์'
          : 'แตะเพื่อย่อรายละเอียด';
      };

      article.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        toggleDetails();
      });

      article.addEventListener('keydown', (event) => {
        if (event.target !== article || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        toggleDetails();
      });

      article.append(
        heading,
        title,
        category,
        date,
        toggleHint,
        details,
      );
      list.append(article);
    }
  } catch (error) {
    list.innerHTML = `<p class="error-text">${error.message}</p>`;
  }
}

function activateTab(panelId) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === panelId);
  });
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.add('hidden'));
  $(`#${panelId}`).classList.remove('hidden');
  $(`#${panelId}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (panelId === 'historyPanel') loadComplaints();
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });
  document.querySelectorAll('[data-open-tab]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.openTab));
  });
}

function openRequestedTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'history') activateTab('historyPanel');
}

function getGeolocationErrorMessage(error, permissionState = 'unknown') {
  if (permissionState === 'denied' || error?.code === 1) {
    return (
      'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง กรุณาเปิดสิทธิ์ตำแหน่งให้แอป LINE ' +
      'แล้วปิดหน้า LIFF และเปิดใหม่ หรือแตะตำแหน่งบนแผนที่แทน'
    );
  }

  switch (error?.code) {
    case 2:
      return 'อุปกรณ์ไม่สามารถระบุตำแหน่งได้ กรุณาเปิด GPS/Wi-Fi หรือแตะตำแหน่งบนแผนที่แทน';
    case 3:
      return 'ค้นหาตำแหน่งนานเกินไป กรุณาลองใหม่หรือแตะตำแหน่งบนแผนที่แทน';
    default:
      return `ไม่สามารถอ่านตำแหน่งปัจจุบันได้${error?.message ? ` (${error.message})` : ''}`;
  }
}

async function getLocationPermissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state || 'unknown';
  } catch {
    // LINE WebView/iOS บางรุ่นไม่รองรับ Permissions API
    return 'unknown';
  }
}

function requestCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function showManualLocationPicker() {
  try {
    const panel = $('#mapPanel');
    const map = ensureMap();

    panel.classList.remove('hidden');

    if (state.latitude === null || state.longitude === null) {
      map.setView([9.1382, 99.3217], 13);
    }

    window.setTimeout(() => {
      map.invalidateSize(true);
      map.getContainer().scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 100);

    $('#locationStatus').textContent =
      'แตะตำแหน่งบนแผนที่เพื่อปักหมุด จากนั้นลากหมุดเพื่อปรับตำแหน่ง';
  } catch (mapError) {
    console.error('Unable to show manual map picker:', mapError);
    showAlert(mapError.message || 'ไม่สามารถเปิดแผนที่ได้');
  }
}

function setupLocation() {
  const button = $('#getLocationButton');
  const manualButton = $('#pickLocationButton');
  const status = $('#locationStatus');

  manualButton?.addEventListener('click', () => {
    clearAlert();
    showManualLocationPicker();
  });

  button.addEventListener('click', async () => {
    clearAlert();

    if (!navigator.geolocation) {
      showAlert('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง กรุณาแตะตำแหน่งบนแผนที่แทน');
      showManualLocationPicker();
      return;
    }

    if (!window.isSecureContext) {
      showAlert('การใช้ตำแหน่งต้องเปิดเว็บผ่าน HTTPS เท่านั้น กรุณาแตะตำแหน่งบนแผนที่แทน');
      status.textContent = 'ไม่สามารถใช้ตำแหน่งบนการเชื่อมต่อที่ไม่ปลอดภัย';
      showManualLocationPicker();
      return;
    }

    const permissionState = await getLocationPermissionState();
    if (permissionState === 'denied') {
      showAlert(getGeolocationErrorMessage({ code: 1 }, permissionState));
      showManualLocationPicker();
      return;
    }

    button.disabled = true;
    button.textContent = '⌖ กำลังค้นหาตำแหน่ง…';
    status.textContent = 'กำลังขอสิทธิ์และค้นหาตำแหน่ง…';

    try {
      let position;
      try {
        position = await requestCurrentPosition({
          enableHighAccuracy: true,
          timeout: 20_000,
          maximumAge: 0,
        });
      } catch (firstError) {
        if (firstError?.code !== 1) {
          position = await requestCurrentPosition({
            enableHighAccuracy: false,
            timeout: 15_000,
            maximumAge: 60_000,
          });
        } else {
          throw firstError;
        }
      }

      const saved = setCoordinates(
        position.coords.latitude,
        position.coords.longitude,
      );

      if (!saved) throw new Error('พิกัดที่ได้รับไม่ถูกต้อง');

      const accuracy = Number(position.coords.accuracy);
      if (Number.isFinite(accuracy)) {
        status.textContent += ` ความคลาดเคลื่อนประมาณ ${Math.round(accuracy)} เมตร`;
      }
    } catch (error) {
      const latestPermissionState = await getLocationPermissionState();
      status.textContent = 'ไม่สามารถอ่านตำแหน่งอัตโนมัติได้ กรุณาเลือกบนแผนที่';
      showAlert(getGeolocationErrorMessage(error, latestPermissionState));
      showManualLocationPicker();
      console.error('Geolocation failed:', {
        code: error?.code,
        message: error?.message,
        permissionState: latestPermissionState,
        isInLineClient: Boolean(window.liff?.isInClient?.()),
      });
    } finally {
      button.disabled = false;
      button.textContent = '⌖ ลองใช้ตำแหน่งปัจจุบันอีกครั้ง';
    }
  });

  $('#latitude').addEventListener('change', syncManualCoordinates);
  $('#longitude').addEventListener('change', syncManualCoordinates);
}

const complaintRequiredFields = [
  { selector: '#categoryId', label: 'หมวดหมู่', message: 'กรุณาเลือกหมวดหมู่' },
  { selector: '#title', label: 'หัวข้อ', message: 'กรุณากรอกหัวข้อ' },
  {
    selector: '#images',
    label: 'รูปภาพประกอบ',
    message: 'กรุณาแนบรูปภาพอย่างน้อย 1 ภาพ',
    validate: () => state.selectedUploadFiles.length > 0,
  },
  {
    selector: '#contactName',
    label: 'ชื่อผู้ติดต่อ',
    message: 'ไม่พบชื่อผู้ติดต่อจากบัญชี LINE กรุณาเข้าสู่ระบบใหม่',
  },
  {
    selector: '#contactPhone',
    label: 'เบอร์โทรศัพท์',
    message: (element) => element.value.trim()
      ? 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง 9–10 หลัก'
      : 'กรุณากรอกเบอร์โทรศัพท์',
    validate: (element) => {
      const phone = element.value.replace(/\D/g, '');
      return phone.length >= 9 && phone.length <= 10;
    },
  },
  {
    selector: '#privacyConsent',
    label: 'การยอมรับประกาศความเป็นส่วนตัว',
    message: 'กรุณายอมรับประกาศความเป็นส่วนตัว',
    validate: (element) => element.checked,
  },
];

function getFieldErrorContainer(element) {
  return (
    element.closest('.file-picker') ||
    element.closest('.consent') ||
    element.closest('label')
  );
}

function removeFieldError(element) {
  if (!element) return;
  element.classList.remove('field-invalid');
  element.removeAttribute('aria-invalid');
  element.removeAttribute('aria-describedby');

  const container = getFieldErrorContainer(element);
  container?.classList.remove('field-container-invalid');
  document.getElementById(`${element.id}-error`)?.remove();
}

function showFieldError(element, message) {
  if (!element) return;
  removeFieldError(element);

  element.classList.add('field-invalid');
  element.setAttribute('aria-invalid', 'true');

  const container = getFieldErrorContainer(element);
  container?.classList.add('field-container-invalid');

  const error = document.createElement('small');
  error.id = `${element.id}-error`;
  error.className = 'field-error';
  error.textContent = message;
  element.setAttribute('aria-describedby', error.id);

  if (element.type === 'file' || element.type === 'checkbox') {
    container?.insertAdjacentElement('afterend', error);
  } else {
    element.insertAdjacentElement('afterend', error);
  }
}

function isRequiredFieldValid(field, element) {
  return field.validate ? field.validate(element) : element.value.trim() !== '';
}

function validateComplaintForm() {
  let firstInvalid = null;
  const invalidLabels = [];

  for (const field of complaintRequiredFields) {
    const element = $(field.selector);
    if (!element) continue;

    removeFieldError(element);
    if (isRequiredFieldValid(field, element)) continue;

    invalidLabels.push(field.label);
    const message = typeof field.message === 'function'
      ? field.message(element)
      : field.message;
    showFieldError(element, message);
    firstInvalid ||= element;
  }

  if (!firstInvalid) return true;

  showAlert(`กรุณาตรวจสอบข้อมูลที่ยังไม่ครบ: ${invalidLabels.join(', ')}`);
  const scrollTarget = getFieldErrorContainer(firstInvalid) || firstInvalid;
  scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => firstInvalid.focus({ preventScroll: true }), 350);
  return false;
}

function setupLiveFieldValidation() {
  for (const field of complaintRequiredFields) {
    const element = $(field.selector);
    if (!element) continue;

    const eventName =
      element.type === 'file' ||
      element.type === 'checkbox' ||
      element.tagName === 'SELECT'
        ? 'change'
        : 'input';

    element.addEventListener(eventName, () => {
      if (isRequiredFieldValid(field, element)) removeFieldError(element);
    });
  }
}

function clearAllFieldErrors() {
  for (const field of complaintRequiredFields) {
    removeFieldError($(field.selector));
  }
  removeFieldError($('#latitude'));
  removeFieldError($('#longitude'));
}

function setupForm() {
  const form = $('#complaintForm');
  const submitButton = $('#submitButton');

  $('#images').addEventListener('change', (event) => addSelectedImages(event.currentTarget));
  $('#cameraImages').addEventListener('change', (event) => addSelectedImages(event.currentTarget));
  setupLiveFieldValidation();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();

    if (!validateComplaintForm()) return;

    const latitude = $('#latitude').value.trim();
    const longitude = $('#longitude').value.trim();
    removeFieldError($('#latitude'));
    removeFieldError($('#longitude'));

    // สถานที่และพิกัดไม่บังคับ แต่ถ้ากรอกพิกัด ต้องกรอกให้ครบทั้งคู่
    if (latitude || longitude) {
      if (!latitude || !longitude || !setCoordinates(latitude, longitude)) {
        const invalidCoordinate = !latitude ? $('#latitude') : $('#longitude');
        showFieldError(
          invalidCoordinate,
          'กรุณากรอก Latitude และ Longitude ให้ครบและถูกต้อง',
        );
        showAlert('ข้อมูลพิกัดไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
        invalidCoordinate.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => invalidCoordinate.focus({ preventScroll: true }), 350);
        return;
      }
    } else {
      state.latitude = null;
      state.longitude = null;
    }

    const selectedFiles = [...state.selectedUploadFiles];

    submitButton.disabled = true;
    submitButton.textContent = 'กำลังอัปโหลดและส่งข้อมูล…';

    try {
      const payload = new FormData();
      payload.set('categoryId', $('#categoryId').value);
      payload.set('title', $('#title').value);
      payload.set('description', $('#description').value);
      payload.set('locationText', $('#locationText').value);
      payload.set('latitude', state.latitude === null ? '' : String(state.latitude));
      payload.set('longitude', state.longitude === null ? '' : String(state.longitude));
      payload.set('contactName', $('#contactName').value);
      payload.set('contactPhone', $('#contactPhone').value);
      payload.set('contactEmail', $('#contactEmail').value);
      payload.set('privacyConsent', String($('#privacyConsent').checked));

      for (const file of selectedFiles) {
        payload.append('images', file, file.name);
      }

      const result = await api('/api/complaints', {
        method: 'POST',
        body: payload,
      });

      form.classList.add('hidden');
      $('#successReference').textContent = result.data.referenceNo;
      $('#successCard').classList.remove('hidden');
    } catch (error) {
      showAlert(error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'ส่งเรื่องร้องเรียน';
    }
  });

  $('#newComplaintButton').addEventListener('click', () => {
    form.reset();
    restoreLineContactName();
    clearAllFieldErrors();
    clearAlert();
    state.latitude = null;
    state.longitude = null;
    state.selectedUploadFiles = [];
    clearImagePreviews();
    $('#locationStatus').textContent = 'ยังไม่ได้บันทึกพิกัด';
    $('#mapPanel').classList.add('hidden');
    if (state.mapMarker && state.map) {
      state.map.removeLayer(state.mapMarker);
      state.mapMarker = null;
    }
    $('#successCard').classList.add('hidden');
    form.classList.remove('hidden');
  });

  $('#refreshButton').addEventListener('click', loadComplaints);
}

async function main() {
  setupImageViewer();
  setupTabs();
  setupLocation();
  setupForm();

  try {
    ensureMap();
  } catch (error) {
    console.error('Map initialization failed:', error);
    showAlert(error.message || 'ไม่สามารถเปิดแผนที่ได้');
  }

  let lineReady = false;
  try {
    lineReady = await initializeLiff();
    if (lineReady) openRequestedTab();
  } catch (error) {
    showAlert(error?.message || 'เชื่อมต่อ LINE ไม่สำเร็จ');
  }

  // หมวดหมู่เป็นข้อมูลสาธารณะ โหลดได้แม้ LINE มีปัญหา
  try {
    await loadCategories();
    if (lineReady) clearAlert();
  } catch (error) {
    console.error('Loading categories failed:', error);
    const apiMessage = `โหลดข้อมูลระบบไม่สำเร็จ (${error?.message || 'UNKNOWN_API_ERROR'})`;
    showAlert(lineReady ? apiMessage : `${$('#alert').textContent} | ${apiMessage}`);
  }
}



//=====Setting redirect Port 80/443
//const express = require('express');
//const http = require('http');
//const https = require('https');
//const fs = require('fs');

//const app = express();

// --- 1. ส่วนของ Logic / Routing ในแอปพลิเคชันของคุณ ---
//app.get('/', (req, res) => {
//    res.send('สวัสดีครับ! เว็บนี้เข้าได้ทั้ง HTTP และ HTTPS');
//});

//app.get('/api/data', (req, res) => {
//    res.json({ message: "Hello World" });
//});


// --- 2. โหลดไฟล์ SSL Certificate สำหรับ HTTPS ---
// ใส่ Path ของไฟล์จริงของคุณ (.key และ .crt หรือ .pem)
//const sslOptions = {
    //key: fs.readFileSync('path/to/private.key'),
    //key: fs.readFileSync('C:\Users\Administrator\Downloads\SSL\69\STAR_suratcity_go_th\privateKey.key'),
    //cert: fs.readFileSync('path/to/certificate.crt')
    //cert: fs.readFileSync('C:\Users\Administrator\Downloads\SSL\69\STAR_suratcity_go_th\STAR_suratcity_go_th.crt')
//};

// --- 3. สั่งให้เปิดรันทั้ง 2 พอร์ตพร้อมกัน ---
//const HTTP_PORT = 80;
//const HTTPS_PORT = 443;

// เปิดพอร์ต 80 (HTTP) Only
//http.createServer(app).listen(HTTP_PORT, () => {
//    console.log(`HTTP Server is running on port ${HTTP_PORT}`);
//});
// เปลี่ยนส่วนการเปิดพอร์ต 80 เป็นแบบนี้แทน เพื่อบังคับใช้ HTTPS ทั้งเว็บ
//http.createServer((req, res) => {
//  res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
//  res.end();
//}).listen(80, () => {
//  console.log("HTTP Server redirection active on port 80");
//});


// เปิดพอร์ต 443 (HTTPS)
//https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
//    console.log(`HTTPS Server is running on port ${HTTPS_PORT}`);
//});


main();
