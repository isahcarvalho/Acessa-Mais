'use strict';

const FEATURES = {
  ramp: 'Rampa de acesso', step_free: 'Entrada sem degraus', restroom: 'Banheiro acessível',
  elevator: 'Elevador acessível', tactile: 'Piso tátil', braille: 'Sinalização em Braille',
  audio: 'Recursos de áudio', libras: 'Atendimento em Libras', visual: 'Informações visuais e escritas',
  simple_language: 'Informações em linguagem simples'
};
const STATUSES = ['Confirmado', 'Não disponível', 'Não informado', 'Em verificação'];
const STATUS_CLASS = {'Confirmado':'confirmado','Não disponível':'nao-disponivel','Não informado':'nao-informado','Em verificação':'em-verificacao'};
const SUGGESTION_TYPES = {
  add_feature: 'Adicionar um recurso de acessibilidade',
  correct_info: 'Corrigir uma informação do local',
  update_contact: 'Atualizar endereço ou contato',
  new_place: 'Sugerir um novo local',
  other: 'Outra sugestão'
};
const CONFIG = window.ACESSA_CONFIG || {};
const configured = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && !CONFIG.supabaseUrl.includes('COLE_AQUI') && !CONFIG.supabaseAnonKey.includes('COLE_AQUI');
const db = configured && window.supabase ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let places = [];
let currentAdmin = null;
let currentUser = null;
let adminTab = 'suggestions';
let recognition = null;
let isListening = false;

const $ = (selector, root=document) => root.querySelector(selector);
const el = (tag, className='', text='') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== '') node.textContent = String(text);
  return node;
};

function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3500);
}

function setupVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { recognition = null; return; }
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = event => {
    $('#search').value = event.results[0][0].transcript;
    renderPlaces();
    toast('Pesquisa por voz realizada!');
  };
  recognition.onerror = event => {
    isListening = false;
    $('#voice-btn').classList.remove('listening');
    toast(event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Permita o acesso ao microfone nas configurações do navegador.'
      : 'Não foi possível reconhecer a voz. Tente novamente.');
  };
  recognition.onend = () => {
    isListening = false;
    $('#voice-btn').classList.remove('listening');
    $('#voice-btn').setAttribute('aria-label', 'Pesquisar por voz');
  };
}

function toggleVoiceSearch() {
  if (!recognition) { toast('A pesquisa por voz não está disponível neste navegador.'); return; }
  if (isListening) { recognition.stop(); return; }
  try {
    isListening = true;
    $('#voice-btn').classList.add('listening');
    $('#voice-btn').setAttribute('aria-label', 'Parar pesquisa por voz');
    recognition.start();
    toast('Pode falar o nome do local que deseja encontrar.');
  } catch (error) {
    isListening = false;
    $('#voice-btn').classList.remove('listening');
    toast('Não foi possível iniciar o microfone. Tente novamente.');
  }
}

function statusPill(status) {
  return el('span', 'status-pill status-' + (STATUS_CLASS[status] || 'nao-informado'), status || 'Não informado');
}
function showModal(id) {
  const modal = $('#' + id);
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}
function hideModal(id) {
  const modal = $('#' + id);
  if (!modal) return;
  modal.hidden = true;
  if (!$('.modal:not([hidden])')) document.body.style.overflow = '';
}
function mapsUrl(address) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address + ', Maringá, Paraná');
}
function configWarning() {
  if (!db) {
    $('#places-grid').replaceChildren(el('div', 'empty', 'O site está pronto, mas ainda falta conectar o banco de dados Supabase. Confira o arquivo supabase-config.js.'));
    $('#suggestion-form button').disabled = true;
    $('#report-form button').disabled = true;
    $('#suggest-feedback').textContent = 'Conexão ainda não configurada.';
    $('#report-feedback').textContent = 'Conexão ainda não configurada.';
    return true;
  }
  return false;
}

function populateSelects() {
  const category = $('#category-filter');
  const current = category.value;
  category.replaceChildren(new Option('Todas as categorias', ''));
  [...new Set(places.map(p => p.category).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, 'pt-BR'))
    .forEach(c => category.add(new Option(c, c)));
  category.value = current;
  const chips = $('#category-chips');
  if (chips) {
    chips.replaceChildren();
    const addChip = (label, value) => {
      const button = el('button', 'category-chip' + (category.value === value ? ' active' : ''), label);
      button.type = 'button';
      button.dataset.category = value;
      button.setAttribute('aria-pressed', String(category.value === value));
      button.addEventListener('click', () => {
        category.value = value;
        chips.querySelectorAll('.category-chip').forEach(chip => {
          const active = chip.dataset.category === value;
          chip.classList.toggle('active', active);
          chip.setAttribute('aria-pressed', String(active));
        });
        renderPlaces();
      });
      chips.append(button);
    };
    addChip('Todos', '');
    [...new Set(places.map(p => p.category).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b, 'pt-BR'))
      .forEach(c => addChip(c, c));
  }
  const placeSelect = $('#suggest-place');
  placeSelect.replaceChildren(new Option('Selecione um local', ''));
  places.forEach(p => placeSelect.add(new Option(p.name, p.id)));
  const featureSelect = $('#suggest-feature');
  featureSelect.replaceChildren(new Option('Selecione um recurso', ''));
  Object.entries(FEATURES).forEach(([key,label]) => featureSelect.add(new Option(label,key)));
}

function renderPlaces() {
  const root = $('#places-grid');
  root.replaceChildren();
  const query = $('#search').value.trim().toLocaleLowerCase('pt-BR');
  const category = $('#category-filter').value;
  const filtered = places.filter(p =>
    (!category || p.category === category) &&
    [p.name, p.category, p.address || ''].join(' ').toLocaleLowerCase('pt-BR').includes(query)
  );
  if (!filtered.length) { root.append(el('div','empty','Nenhum local encontrado com essa busca.')); return; }
  filtered.forEach(place => {
    const card = el('article','place-card');
    const photoWrap = el('div','place-photo');
    const photoUrl = [place.photo_url, place.photo, place.image_url].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
    if (photoUrl) {
      const photo = el('img','place-photo-image');
      photo.src = photoUrl;
      photo.alt = `Fachada de ${place.name}`;
      photo.loading = 'lazy';
      photo.referrerPolicy = 'no-referrer';
      photo.addEventListener('error', () => {
        photo.remove();
        photoWrap.classList.add('photo-placeholder');
        photoWrap.append(el('span','photo-placeholder-icon','⌂'),el('span','photo-placeholder-text','Foto indisponível'));
      }, {once:true});
      photoWrap.append(photo);
    } else {
      photoWrap.classList.add('photo-placeholder');
      photoWrap.append(el('span','photo-placeholder-icon','⌂'),el('span','photo-placeholder-text','Foto da fachada em breve'));
    }
    card.append(photoWrap);
    card.append(el('span','place-category',place.category || 'Local'));
    card.append(el('h3','',place.name));
    card.append(el('p','place-address',place.address || 'Endereço não informado'));
    const summary = el('div','place-summary');
    const entries = Object.entries(FEATURES);
    const confirmed = entries.filter(([key]) => (place.accessibility || {})[key] === 'Confirmado').length;
    const checked = entries.filter(([key]) => ['Confirmado','Não disponível'].includes((place.accessibility || {})[key])).length;
    summary.append(el('span','status-pill status-nao-informado',checked ? `${confirmed} recurso(s) confirmado(s)` : 'Acessibilidade ainda não verificada'));
    card.append(summary);
    const actions = el('div','card-actions');
    const details = el('button','text-button','Ver informações e avaliações →');
    details.type = 'button';
    details.addEventListener('click', () => openPlace(place.id));
    actions.append(details);
    card.append(actions);
    root.append(card);
  });
}

function openPlace(id) {
  const place = places.find(p => p.id === id);
  if (!place) return;
  const root = $('#place-detail');
  root.replaceChildren();
  const head = el('div','detail-head');
  head.append(el('span','eyebrow blue',place.category || 'LOCAL'));
  head.append(el('h2','',place.name));
  head.append(el('p','detail-meta',place.description || 'Informações do estabelecimento.'));
  root.append(head);
  const contact = el('div','detail-contact');
  contact.append(el('span','',`⌖ ${place.address || 'Endereço não informado'}`));
  contact.append(el('span','',`☎ ${place.phone || 'Telefone não informado'}`));
  root.append(contact);
  const map = el('a','button button-ghost','Ver endereço no mapa');
  map.href = mapsUrl(place.address || place.name);
  map.target = '_blank';
  map.rel = 'noopener noreferrer';
  root.append(map);
  root.append(el('h3','','Recursos de acessibilidade'));
  const list = el('div','feature-list');
  Object.entries(FEATURES).forEach(([key,label]) => {
    const row = el('div','feature-row');
    row.append(el('b','',label),statusPill((place.accessibility || {})[key] || 'Não informado'));
    list.append(row);
  });
  root.append(list);
  root.append(el('p','detail-note','As informações são atualizadas após análise da equipe Acessa+. “Não informado” não significa que o recurso não exista. Consulte o local para confirmar condições que possam mudar.'));
  if (place.updated_at) {
    const date = new Date(place.updated_at);
    root.append(el('p','small-note',`Última atualização cadastrada: ${date.toLocaleDateString('pt-BR')}`));
  }
  const reviews = el('section','review-section');
  reviews.id = 'place-reviews';
  reviews.append(el('h3','','Avaliações e comentários'));
  reviews.append(el('div','loading','Carregando avaliações…'));
  root.append(reviews);
  showModal('place-modal');
  loadReviews(place.id, reviews);
}

async function loadPlaces() {
  if (configWarning()) return;
  $('#places-grid').replaceChildren(el('div','loading','Buscando locais…'));
  const {data,error} = await db.from('places').select('*').eq('published',true).order('name');
  if (error) {
    console.error(error);
    $('#places-grid').replaceChildren(el('div','empty','Não foi possível carregar os locais. Confira a configuração do Supabase e as políticas do banco.'));
    return;
  }
    places = data || [];
  populateSelects();
  renderPlaces();
}

function updateSuggestionFields() {
  const type = $('#suggest-type').value;
  const isFeature = type === 'add_feature';

  $('#suggest-place-label').hidden = type === 'new_place';
  $('#suggest-feature-label').hidden = !isFeature;
  $('#suggest-status-label').hidden = !isFeature;

  $('#suggest-place').required = [
    'add_feature',
    'correct_info',
    'update_contact'
  ].includes(type);

  $('#suggest-feature').required = isFeature;
  $('#suggest-status').required = isFeature;
}
async function submitSuggestion(event) {
  event.preventDefault();
  if (!db) return;

  const type = $('#suggest-type').value;
  const placeId = $('#suggest-place').value || null;
  const feature = $('#suggest-feature').value || null;
  const status = $('#suggest-status').value || null;
  const note = $('#suggest-note').value.trim();

  if (!SUGGESTION_TYPES[type] || note.length < 8) {
    toast('Confira os campos da sugestão.');
    return;
  }

  if (['add_feature', 'correct_info', 'update_contact'].includes(type) && !placeId) {
    toast('Selecione o local.');
    return;
  }

  if (type === 'add_feature' &&
      (!feature || !STATUSES.includes(status))) {
    toast('Selecione o recurso e a informação sugerida.');
    return;
  }

  const payload = {
    suggestion_type: type,
    place_id: placeId,
    feature_key: type === 'add_feature' ? feature : null,
    suggested_status: type === 'add_feature' ? status : null,
    note,
    contact: $('#suggest-contact').value.trim() || null
  };

  const button = $('#suggestion-form button[type="submit"]');
  button.disabled = true;

  const { error } = await db.from('suggestions').insert(payload);

  button.disabled = false;

  if (error) {
    console.error(error);
    toast('Não foi possível enviar. Tente novamente mais tarde.');
    return;
  }

  event.target.reset();
  updateSuggestionFields();

  $('#suggest-feedback').textContent =
    'Sugestão enviada! Ela ficará aguardando análise da equipe.';

  toast('Sugestão enviada para análise.');
}

async function submitReport(event) {
  event.preventDefault();
  if (!db) return;
  const payload = {
    problem_type: $('#report-type').value,
    location_text: $('#report-location').value.trim(),
    description: $('#report-description').value.trim()
  };
  if (!payload.problem_type || payload.location_text.length < 5 || payload.description.length < 10) {
    toast('Confira os campos do relato.'); return;
  }
  const button = $('#report-form button');
  button.disabled = true;
  const {error} = await db.from('reports').insert(payload);
  button.disabled = false;
  if (error) { console.error(error); toast('Não foi possível enviar o relato.'); return; }
  event.target.reset();
  $('#report-feedback').textContent = 'Relato recebido pela equipe Acessa+. Obrigado por contribuir.';
  toast('Relato enviado.');
}

/* Cadastro e login de usuários comuns */
function openAccount() {
  showModal('account-modal');
  renderAccount();
}
function renderAccount() {
  const root = $('#account-content');
  root.replaceChildren();
  root.append(el('span','eyebrow blue','ACESSA+'));
  root.append(el('h2','','Minha conta'));
  if (currentUser) {
    root.append(el('p','account-status','Você está conectado. Sua conta pode avaliar locais e publicar comentários.'));
    root.append(el('p','small-note', 'Conta conectada com sucesso.'));
    const logout = el('button','button button-primary','Sair da conta');
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      const {error} = await db.auth.signOut();
      if (error) { toast('Não foi possível sair da conta.'); return; }
      currentUser = null;
      renderAccount();
      toast('Você saiu da sua conta.');
    });
    root.append(logout);
    return;
  }

  root.append(el('p','account-intro','Entre para avaliar os locais e compartilhar sua experiência.'));
  const loginForm = el('form','form-card compact');
  loginForm.id = 'account-login-form';
  const emailLabel = el('label','','E-mail');
  const email = el('input'); email.type = 'email'; email.id = 'account-email'; email.autocomplete = 'email'; email.required = true;
  emailLabel.append(email);
  const passLabel = el('label','','Senha');
  const password = el('input'); password.type = 'password'; password.id = 'account-password'; password.autocomplete = 'current-password'; password.required = true;
  passLabel.append(password);
  const submit = el('button','button button-primary','Entrar'); submit.type = 'submit';
  const feedback = el('p','feedback',''); feedback.id = 'account-feedback';
  loginForm.append(emailLabel,passLabel,submit,feedback);
  loginForm.addEventListener('submit',signInUser);
  root.append(loginForm);
  const signup = el('button','button button-ghost account-switch','Criar minha conta');
  signup.type = 'button';
  signup.addEventListener('click',renderSignup);
  root.append(signup);
}
function renderSignup() {
  const root = $('#account-content');
  root.replaceChildren();
  root.append(el('span','eyebrow blue','ACESSA+'));
  root.append(el('h2','','Criar minha conta'));
  root.append(el('p','account-intro','Use um e-mail válido. Enviaremos uma mensagem para confirmar o cadastro.'));
  const form = el('form','form-card compact');
  form.id = 'account-signup-form';
  const emailLabel = el('label','','E-mail');
  const email = el('input'); email.type = 'email'; email.id = 'signup-email'; email.autocomplete = 'email'; email.required = true;
  emailLabel.append(email);
  const passLabel = el('label','','Crie uma senha (mínimo de 6 caracteres)');
  const password = el('input'); password.type = 'password'; password.id = 'signup-password'; password.autocomplete = 'new-password'; password.minLength = 6; password.required = true;
  passLabel.append(password);
  const confirmLabel = el('label','','Confirme a senha');
  const confirm = el('input'); confirm.type = 'password'; confirm.id = 'signup-confirm'; confirm.autocomplete = 'new-password'; confirm.minLength = 6; confirm.required = true;
  confirmLabel.append(confirm);
  const submit = el('button','button button-primary','Criar conta'); submit.type = 'submit';
  const feedback = el('p','feedback',''); feedback.id = 'account-feedback';
  form.append(emailLabel,passLabel,confirmLabel,submit,feedback);
  form.addEventListener('submit',signUpUser);
  root.append(form);
  const back = el('button','button button-ghost account-switch','Voltar para entrar');
  back.type = 'button'; back.addEventListener('click',renderAccount);
  root.append(back);
}
async function signInUser(event) {
  event.preventDefault();
  if (!db) { $('#account-feedback').textContent = 'O sistema ainda não está conectado.'; return; }
  const email = $('#account-email').value.trim();
  const password = $('#account-password').value;
  const button = $('#account-login-form button[type="submit"]');
  button.disabled = true;
  const {data,error} = await db.auth.signInWithPassword({email,password});
  button.disabled = false;
  if (error) {
    $('#account-feedback').textContent = 'Não foi possível entrar. Confira o e-mail, a senha e a confirmação do cadastro.';
    return;
  }
  currentUser = data.user;
  renderAccount();
  toast('Login realizado! Você já pode avaliar os locais.');
  refreshOpenPlaceReviews();
}
async function signUpUser(event) {
  event.preventDefault();
  if (!db) { $('#account-feedback').textContent = 'O sistema ainda não está conectado.'; return; }
  const email = $('#signup-email').value.trim();
  const password = $('#signup-password').value;
  const confirm = $('#signup-confirm').value;
  if (password.length < 6) { $('#account-feedback').textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
  if (password !== confirm) { $('#account-feedback').textContent = 'As senhas não são iguais.'; return; }
  const button = $('#account-signup-form button[type="submit"]');
  button.disabled = true;
  const {data,error} = await db.auth.signUp({email,password});
  button.disabled = false;
  if (error) {
    $('#account-feedback').textContent = 'Não foi possível criar a conta. Confira o e-mail e tente novamente.';
    console.error(error);
    return;
  }
  if (data.session && data.user) {
    currentUser = data.user;
    renderAccount();
    toast('Conta criada! Você já pode avaliar os locais.');
    refreshOpenPlaceReviews();
  } else {
    const root = $('#account-content');
    root.replaceChildren(el('span','eyebrow blue','CADASTRO REALIZADO'));
    root.append(el('h2','','Confira seu e-mail'));
    root.append(el('p','account-intro','Enviamos um link de confirmação para o endereço informado. Confirme o cadastro e depois volte para entrar na sua conta.'));
    const back = el('button','button button-primary account-switch','Voltar para entrar');
    back.type = 'button'; back.addEventListener('click',renderAccount);
    root.append(back);
  }
}
function refreshOpenPlaceReviews() {
  const modal = $('#place-modal');
  if (!modal || modal.hidden) return;
  const heading = $('#place-detail .detail-head h2');
  const place = places.find(p => p.name === heading?.textContent);
  const section = $('#place-reviews');
  if (place && section) loadReviews(place.id, section);
}

/* Avaliações: leitura pública; envio/edição apenas com sessão autenticada */
async function loadReviews(placeId, root) {
  root.replaceChildren(el('h3','','Avaliações e comentários'));
  const {data,error} = await db.from('reviews').select('id, place_id, user_id, rating, comment, created_at, updated_at')
    .eq('place_id',placeId).order('created_at',{ascending:false});
  if (error) {
    console.error(error);
    root.append(el('p','review-empty','Não foi possível carregar as avaliações agora.'));
    return;
  }
  const reviews = data || [];
  const average = reviews.length ? reviews.reduce((sum,item) => sum + Number(item.rating || 0),0) / reviews.length : 0;
  const summary = el('div','review-summary');
  summary.append(el('span','review-average',reviews.length ? average.toFixed(1).replace('.',',') : '—'));
  summary.append(el('span','review-stars',reviews.length ? '★'.repeat(Math.round(average)) + '☆'.repeat(5-Math.round(average)) : '☆☆☆☆☆'));
  summary.append(el('span','',reviews.length ? `${reviews.length} avaliação(ões)` : 'Ainda não há avaliações'));
  root.append(summary);

  const ownReview = currentUser ? reviews.find(item => item.user_id === currentUser.id) : null;
  if (currentUser) {
    const form = el('form','review-form');
    form.id = 'review-form';
    const ratingLabel = el('label','','Sua nota');
    const rating = el('select'); rating.id = 'review-rating'; rating.required = true;
    rating.add(new Option('Selecione uma nota',''));
    [5,4,3,2,1].forEach(n => rating.add(new Option(`${n} estrela(s)`,String(n))));
    if (ownReview) rating.value = String(ownReview.rating);
    ratingLabel.append(rating);
    const commentLabel = el('label','','Seu comentário (opcional)');
    const comment = el('textarea'); comment.id = 'review-comment'; comment.rows = 3; comment.maxLength = 1000;
    comment.placeholder = 'Conte como foi sua experiência neste local.';
    comment.value = ownReview?.comment || '';
    commentLabel.append(comment);
    const submit = el('button','button button-primary',ownReview ? 'Atualizar minha avaliação' : 'Publicar avaliação');
    submit.type = 'submit';
    form.append(ratingLabel,commentLabel,submit);
    form.addEventListener('submit',event => saveReview(event,placeId,ownReview));
    root.append(form);
  } else {
    const note = el('p','review-login-note','Entre na sua conta para avaliar este local. ');
    const loginButton = el('button','','Fazer login');
    loginButton.type = 'button';
    loginButton.addEventListener('click',() => { hideModal('place-modal'); openAccount(); });
    note.append(loginButton);
    root.append(note);
  }

  const list = el('div','review-list');
  if (!reviews.length) {
    list.append(el('p','review-empty','Seja a primeira pessoa a avaliar este local.'));
  } else {
    reviews.forEach(item => {
      const card = el('article','review-card');
      const head = el('div','review-card-head');
      head.append(el('span','review-author','Usuário do Acessa+'));
      const date = item.created_at ? new Date(item.updated_at || item.created_at).toLocaleDateString('pt-BR') : '';
      head.append(el('span','review-date',date));
      card.append(head);
      card.append(el('div','review-stars','★'.repeat(Math.max(0,Math.min(5,Number(item.rating)))) + '☆'.repeat(5-Math.max(0,Math.min(5,Number(item.rating))))));
      if (item.comment) card.append(el('p','',item.comment));
      if (currentUser && item.user_id === currentUser.id) card.append(el('span','review-date','Esta é sua avaliação; você pode atualizá-la acima.'));
      list.append(card);
    });
  }
  root.append(list);
}
async function saveReview(event,placeId,existingReview) {
  event.preventDefault();
  if (!currentUser) { toast('Entre na sua conta para avaliar.'); return; }
  const rating = Number($('#review-rating').value);
  const comment = $('#review-comment').value.trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) { toast('Escolha uma nota de 1 a 5 estrelas.'); return; }
  const button = $('#review-form button[type="submit"]');
  button.disabled = true;
  const payload = {
    place_id: placeId,
    user_id: currentUser.id,
    rating,
    comment: comment || null,
    updated_at: new Date().toISOString()
  };
  const {error} = await db.from('reviews').upsert(payload,{onConflict:'place_id,user_id'});
  button.disabled = false;
  if (error) {
    console.error(error);
    toast('Não foi possível salvar. Confira sua conexão e as permissões da tabela reviews.');
    return;
  }
  toast(existingReview ? 'Sua avaliação foi atualizada.' : 'Avaliação publicada. Obrigado por contribuir!');
  const section = $('#place-reviews');
  if (section) await loadReviews(placeId,section);
}

function openAdmin() {
  showModal('admin-modal');
  if (currentAdmin) renderAdmin();
  else renderLogin();
}
async function login(event) {
  event.preventDefault();
  if (!db) { $('#login-feedback').textContent = 'Configure o Supabase antes de entrar.'; return; }
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const button = $('#login-form button');
  button.disabled = true;
  const {data,error} = await db.auth.signInWithPassword({email,password});
  button.disabled = false;
  if (error) { $('#login-feedback').textContent = 'Não foi possível entrar. Confira e-mail e senha.'; return; }
  currentAdmin = data.user;
  await verifyAdmin();
}
async function verifyAdmin() {
  if (!currentAdmin) return;
  const {data,error} = await db.from('profiles').select('role').eq('id',currentAdmin.id).single();
  if (error || data?.role !== 'admin') {
    currentAdmin = null;
    await db.auth.signOut();
    const feedback = $('#login-feedback');
    if (feedback) feedback.textContent = 'Esta conta não tem permissão de administração.';
    return;
  }
  renderAdmin();
}
function renderAdmin() {
  const root = $('#admin-content');
  root.replaceChildren();
  root.append(el('span','eyebrow blue','PAINEL RESTRITO'));
  root.append(el('h2','','Painel da equipe Acessa+'));
  root.append(el('p','small-note',`Sessão: ${currentAdmin.email}`));
  const logout = el('button','button button-ghost','Sair');
  logout.type = 'button';
  logout.addEventListener('click',async () => {
    await db.auth.signOut();
    currentAdmin = null;
    currentUser = null;
    renderLogin();
  });
  root.append(logout);
  const tabs = el('div','admin-tabs');
  [['suggestions','Sugestões'],['reports','Relatos'],['places','Locais']].forEach(([key,label]) => {
    const b = el('button',adminTab === key ? 'active' : '',label);
    b.type = 'button';
    b.addEventListener('click',() => { adminTab = key; renderAdmin(); });
    tabs.append(b);
  });
  root.append(tabs);
  const content = el('div','');
  content.id = 'admin-list';
  root.append(content);
  loadAdminTab(content);
}
function renderLogin() {
  const root = $('#admin-content');
  root.replaceChildren();
  root.append(el('span','eyebrow blue','ACESSO RESTRITO'));
  root.append(el('h2','','Área da equipe'));
  root.append(el('p','','Entre com a conta autorizada pela administração do Acessa+.'));
  const form = el('form','form-card compact');
  form.id = 'login-form';
  const emailLabel = el('label','','E-mail');
  const email = el('input'); email.type = 'email'; email.id = 'login-email'; email.autocomplete = 'username'; email.required = true;
  emailLabel.append(email);
  const passLabel = el('label','','Senha');
  const pass = el('input'); pass.type = 'password'; pass.id = 'login-password'; pass.autocomplete = 'current-password'; pass.required = true;
  passLabel.append(pass);
  const submit = el('button','button button-primary','Entrar'); submit.type = 'submit';
  const feedback = el('p','feedback',''); feedback.id = 'login-feedback';
  form.append(emailLabel,passLabel,submit,feedback);
  form.addEventListener('submit',login);
  root.append(form);
}

async function loadAdminTab(root) {
  root.replaceChildren(el('div','loading','Carregando painel…'));
  const table = adminTab;
  let query = db.from(table).select('*').order('created_at',{ascending:false}).limit(100);
  if (table === 'places') query = db.from('places').select('*').order('name');
  const {data,error} = await query;
  if (error) { root.replaceChildren(el('div','empty','Não foi possível carregar esta lista.')); console.error(error); return; }
  root.replaceChildren();
  if (!data?.length) { root.append(el('div','empty','Nenhum registro por aqui.')); return; }
  if (table === 'suggestions') data.forEach(item => root.append(suggestionAdminCard(item)));
  if (table === 'reports') data.forEach(item => root.append(reportAdminCard(item)));
  if (table === 'places') data.forEach(item => root.append(placeAdminCard(item)));
}
function suggestionAdminCard(item) {
  const card = el('article', 'admin-item');

  const place = places.find(p => p.id === item.place_id);
  const type = item.suggestion_type || 'add_feature';

  card.append(el('h3', '', SUGGESTION_TYPES[type] || 'Sugestão'));
  card.append(el('p', '', `Local: ${place?.name || (type === 'new_place' ? 'Novo local sugerido' : 'Não informado')}`));

  if (type === 'add_feature') {
    card.append(el('p', '', `${FEATURES[item.feature_key] || item.feature_key}: ${item.suggested_status}`));
  }

  card.append(el('p', '', item.note));
  card.append(el('p', '', `Contato: ${item.contact || 'Não informado'}`));
  card.append(el('p', '', `Situação: ${item.review_status || 'Pendente'}`));

  if (item.review_status === 'Pendente') {
    const actions = el('div', 'admin-actions');

    const approve = el(
      'button',
      'button button-primary',
      type === 'add_feature' ? 'Aprovar e publicar' : 'Marcar como analisada'
    );

    approve.type = 'button';
    approve.addEventListener('click', () => approveSuggestion(item));

    const reject = el('button', 'button button-danger', 'Rejeitar');
    reject.type = 'button';
    reject.addEventListener('click', () =>
      updateSuggestionStatus(item.id, 'Rejeitada')
    );

    actions.append(approve, reject);
    card.append(actions);
  }

  return card;
}
function reportAdminCard(item) {
  const card = el('article','admin-item');
  card.append(el('h3','',item.problem_type),el('p','',item.location_text),el('p','',item.description));
  const select = el('select');
  ['Recebido','Em análise','Encaminhado ao responsável','Resolvido'].forEach(s => select.add(new Option(s,s)));
  select.value = item.status;
  const save = el('button','button button-muted','Atualizar situação');
  save.type = 'button';
  save.addEventListener('click',async () => {
    const {error} = await db.from('reports').update({status:select.value}).eq('id',item.id);
    if (error) { toast('Não foi possível atualizar o relato.'); return; }
    toast('Situação atualizada.'); loadAdminTab($('#admin-list'));
  });
  card.append(el('p','',`Status atual: ${item.status}`),select,save);
  return card;
}
function placeAdminCard(place) {
  const card = el('article','admin-item');
  card.append(el('h3','',place.name),el('p','',place.address || 'Endereço não informado'));
  const grid = el('div','');
  Object.entries(FEATURES).forEach(([key,label]) => {
    const wrap = el('label','',label);
    const select = el('select');
    STATUSES.forEach(s => select.add(new Option(s,s)));
    select.value = (place.accessibility || {})[key] || 'Não informado';
    select.dataset.feature = key;
    wrap.append(select); grid.append(wrap);
  });
  const save = el('button','button button-primary','Salvar recursos');
  save.type = 'button';
  save.addEventListener('click',async () => {
    const accessibility = {...(place.accessibility || {})};
    grid.querySelectorAll('select').forEach(s => accessibility[s.dataset.feature] = s.value);
    const {error} = await db.from('places').update({accessibility,updated_at:new Date().toISOString()}).eq('id',place.id);
    if (error) { toast('Não foi possível salvar.'); return; }
    toast('Informações atualizadas para todos os usuários.');
    await loadPlaces(); loadAdminTab($('#admin-list'));
  });
  card.append(grid,save);
  return card;
}
async function approveSuggestion(item) {
  const type = item.suggestion_type || 'add_feature';

  if (type === 'add_feature') {
    const place = places.find(p => p.id === item.place_id);

    if (!place || !FEATURES[item.feature_key] ||
        !STATUSES.includes(item.suggested_status)) {
      toast('Não foi possível validar essa sugestão.');
      return;
    }

    const accessibility = {
      ...(place.accessibility || {}),
      [item.feature_key]: item.suggested_status
    };

    const update = await db.from('places')
      .update({
        accessibility,
        updated_at: new Date().toISOString()
      })
      .eq('id', place.id);

    if (update.error) {
      toast('Não foi possível atualizar o local.');
      return;
    }
  }

  const review = await db.from('suggestions')
    .update({ review_status: 'Aprovada' })
    .eq('id', item.id);

  if (review.error) {
    toast('Não foi possível atualizar a situação da sugestão.');
    return;
  }

  toast(
    type === 'add_feature'
      ? 'Sugestão aprovada e informação publicada!'
      : 'Sugestão analisada e aprovada!'
  );

  await loadPlaces();
  loadAdminTab($('#admin-list'));
}
async function updateSuggestionStatus(id,status) {
  const {error} = await db.from('suggestions').update({review_status:status}).eq('id',id);
  if (error) { toast('Não foi possível atualizar a sugestão.'); return; }
  toast('Sugestão atualizada.'); loadAdminTab($('#admin-list'));
}

function init() {
  document.addEventListener('click',event => {
    const close = event.target.closest('[data-close]');
    if (close) hideModal(close.dataset.close + '-modal');
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape') {
      hideModal('place-modal'); hideModal('admin-modal'); hideModal('account-modal');
    }
  });

  $('#search').addEventListener('input',renderPlaces);
  $('#category-filter').addEventListener('change',() => {
    $('#category-chips')?.querySelectorAll('.category-chip').forEach(chip => {
      const active = chip.dataset.category === $('#category-filter').value;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
    renderPlaces();
  });
  $('#voice-btn').addEventListener('click',toggleVoiceSearch);
  setupVoiceSearch();
  $('#suggestion-form').addEventListener('submit',submitSuggestion);
  $('#suggest-type').addEventListener('change', updateSuggestionFields);
updateSuggestionFields();
  $('#report-form').addEventListener('submit',submitReport);
  $('#admin-open').addEventListener('click',openAdmin);
  $('#account-open').addEventListener('click',openAccount);

  if (configWarning()) {
    renderLogin();
    return;
  }
  renderLogin();

  db.auth.getSession().then(async ({data,error}) => {
    if (error || !data.session) return;
    currentUser = data.session.user;
    const {data:profile} = await db.from('profiles').select('role').eq('id',currentUser.id).maybeSingle();
    if (profile?.role === 'admin') {
      currentAdmin = currentUser;
      if (!$('#admin-modal').hidden) renderAdmin();
    }
  });

  db.auth.onAuthStateChange((_event,session) => {
    currentUser = session?.user || null;
    if (!session) currentAdmin = null;
  });

  loadPlaces();
}

document.addEventListener('DOMContentLoaded',init);
