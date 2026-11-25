
'use strict';

const FEATURES = {
  ramp: 'Rampa de acesso', step_free: 'Entrada sem degraus', restroom: 'Banheiro acessível',
  elevator: 'Elevador acessível', tactile: 'Piso tátil', braille: 'Sinalização em Braille',
  audio: 'Recursos de áudio', libras: 'Atendimento em Libras', visual: 'Informações visuais e escritas',
  simple_language: 'Informações em linguagem simples'
};
const STATUSES = ['Confirmado', 'Não disponível', 'Não informado', 'Em verificação'];
const STATUS_CLASS = {'Confirmado':'confirmado','Não disponível':'nao-disponivel','Não informado':'nao-informado','Em verificação':'em-verificacao'};
const CONFIG = window.ACESSA_CONFIG || {};
const configured = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && !CONFIG.supabaseUrl.includes('COLE_AQUI') && !CONFIG.supabaseAnonKey.includes('COLE_AQUI');
const db = configured && window.supabase ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : null;

let places = [];
let currentAdmin = null;
let adminTab = 'suggestions';

// PESQUISA POR VOZ
let recognition = null;
let isListening = false;

const $ = (selector, root=document) => root.querySelector(selector);
const el = (tag, className='', text='') => { const node=document.createElement(tag); if(className) node.className=className; if(text!==undefined && text!=='') node.textContent=String(text); return node; };

function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),3500);}

// CONFIGURAÇÃO DO MICROFONE
function setupVoiceSearch(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if(!SpeechRecognition){
    recognition = null;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    $('#search').value = transcript;
    renderPlaces();
    toast('Pesquisa por voz realizada!');
  };

  recognition.onerror = (event) => {
    isListening = false;
    $('#voice-btn').classList.remove('listening');

    if(event.error === 'not-allowed' || event.error === 'service-not-allowed'){
      toast('Permita o acesso ao microfone nas configurações do navegador.');
    } else {
      toast('Não foi possível reconhecer a voz. Tente novamente.');
    }
  };

  recognition.onend = () => {
    isListening = false;
    $('#voice-btn').classList.remove('listening');
    $('#voice-btn').setAttribute('aria-label', 'Pesquisar por voz');
  };
}

function toggleVoiceSearch(){
  if(!recognition){
    toast('A pesquisa por voz não está disponível neste navegador.');
    return;
  }

  if(isListening){
    recognition.stop();
    return;
  }

  try{
    isListening = true;
    $('#voice-btn').classList.add('listening');
    $('#voice-btn').setAttribute('aria-label', 'Parar pesquisa por voz');
    recognition.start();
    toast('Pode falar o nome do local que deseja encontrar.');
  }catch(error){
    isListening = false;
    $('#voice-btn').classList.remove('listening');
    toast('Não foi possível iniciar o microfone. Tente novamente.');
  }
}

function statusPill(status){const pill=el('span','status-pill status-'+(STATUS_CLASS[status]||'nao-informado'),status||'Não informado');return pill;}
function showModal(id){$('#'+id).hidden=false;document.body.style.overflow='hidden';}
function hideModal(id){$('#'+id).hidden=true;document.body.style.overflow='';}
function mapsUrl(address){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address+', Maringá, Paraná');}
function configWarning(){if(!db){$('#places-grid').replaceChildren(el('div','empty','O site está pronto, mas ainda falta conectar o banco de dados Supabase. Siga o passo a passo do arquivo LEIA-ME para ativar os dados compartilhados.'));$('#suggestion-form button').disabled=true;$('#report-form button').disabled=true;$('#suggest-feedback').textContent='Conexão ainda não configurada.';$('#report-feedback').textContent='Conexão ainda não configurada.';return true;}return false;}
function populateSelects(){const category=$('#category-filter');const current=category.value;category.replaceChildren(new Option('Todas as categorias',''));[...new Set(places.map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(c=>category.add(new Option(c,c)));category.value=current;const placeSelect=$('#suggest-place');placeSelect.replaceChildren(new Option('Selecione um local',''));places.forEach(p=>placeSelect.add(new Option(p.name,p.id)));const featureSelect=$('#suggest-feature');featureSelect.replaceChildren(new Option('Selecione um recurso',''));Object.entries(FEATURES).forEach(([key,label])=>featureSelect.add(new Option(label,key)));}
function renderPlaces(){const root=$('#places-grid');root.replaceChildren();const query=$('#search').value.trim().toLocaleLowerCase('pt-BR');const category=$('#category-filter').value;const filtered=places.filter(p=>(!category||p.category===category)&&[p.name,p.category,p.address||''].join(' ').toLocaleLowerCase('pt-BR').includes(query));if(!filtered.length){root.append(el('div','empty','Nenhum local encontrado com essa busca.'));return;}filtered.forEach(place=>{const card=el('article','place-card');card.append(el('span','place-category',place.category||'Local'));card.append(el('h3','',place.name));card.append(el('p','place-address',place.address||'Endereço não informado'));const summary=el('div','place-summary');const entries=Object.entries(FEATURES);const confirmed=entries.filter(([key])=>(place.accessibility||{})[key]==='Confirmado').length;const checked=entries.filter(([key])=>['Confirmado','Não disponível'].includes((place.accessibility||{})[key])).length;summary.append(el('span','status-pill status-nao-informado',checked?`${confirmed} recurso(s) confirmado(s)`:'Acessibilidade ainda não verificada'));card.append(summary);const actions=el('div','card-actions');const details=el('button','text-button','Ver informações e recursos →');details.type='button';details.addEventListener('click',()=>openPlace(place.id));actions.append(details);card.append(actions);root.append(card);});}
function openPlace(id){const place=places.find(p=>p.id===id);if(!place)return;const root=$('#place-detail');root.replaceChildren();const head=el('div','detail-head');head.append(el('span','eyebrow blue',place.category||'LOCAL'));head.append(el('h2','',place.name));head.append(el('p','detail-meta',place.description||'Informações do estabelecimento.'));root.append(head);const contact=el('div','detail-contact');contact.append(el('span','',`⌖ ${place.address||'Endereço não informado'}`));contact.append(el('span','',`☎ ${place.phone||'Telefone não informado'}`));root.append(contact);const map=el('a','button button-ghost','Ver endereço no mapa');map.href=mapsUrl(place.address||place.name);map.target='_blank';map.rel='noopener noreferrer';root.append(map);root.append(el('h3','','Recursos de acessibilidade'));const list=el('div','feature-list');Object.entries(FEATURES).forEach(([key,label])=>{const row=el('div','feature-row');row.append(el('b','',label),statusPill((place.accessibility||{})[key]||'Não informado'));list.append(row);});root.append(list);const note=el('p','detail-note','As informações são atualizadas após análise da equipe Acessa+. “Não informado” não significa que o recurso não exista. Consulte o local para confirmar condições que possam mudar.');root.append(note);if(place.updated_at){const date=new Date(place.updated_at);root.append(el('p','small-note',`Última atualização cadastrada: ${date.toLocaleDateString('pt-BR')}`));}showModal('place-modal');}
async function loadPlaces(){if(configWarning())return;$('#places-grid').replaceChildren(el('div','loading','Buscando locais…'));const {data,error}=await db.from('places').select('*').eq('published',true).order('name');if(error){console.error(error);$('#places-grid').replaceChildren(el('div','empty','Não foi possível carregar os locais. Confira a configuração do Supabase e as políticas do banco.'));return;}places=data||[];populateSelects();renderPlaces();}
async function submitSuggestion(event){event.preventDefault();if(!db)return;const payload={place_id:$('#suggest-place').value,feature_key:$('#suggest-feature').value,suggested_status:$('#suggest-status').value,note:$('#suggest-note').value.trim(),contact:$('#suggest-contact').value.trim()||null};if(!payload.place_id||!payload.feature_key||!STATUSES.includes(payload.suggested_status)||payload.note.length<8){toast('Confira os campos da sugestão.');return;}const button=$('#suggestion-form button');button.disabled=true;const {error}=await db.from('suggestions').insert(payload);button.disabled=false;if(error){console.error(error);toast('Não foi possível enviar. Tente novamente mais tarde.');return;}event.target.reset();$('#suggest-feedback').textContent='Sugestão enviada! Ela ficará aguardando análise da equipe.';toast('Sugestão enviada para análise.');}
async function submitReport(event){event.preventDefault();if(!db)return;const payload={problem_type:$('#report-type').value,location_text:$('#report-location').value.trim(),description:$('#report-description').value.trim()};if(!payload.problem_type||payload.location_text.length<5||payload.description.length<10){toast('Confira os campos do relato.');return;}const button=$('#report-form button');button.disabled=true;const {error}=await db.from('reports').insert(payload);button.disabled=false;if(error){console.error(error);toast('Não foi possível enviar o relato.');return;}event.target.reset();$('#report-feedback').textContent='Relato recebido pela equipe Acessa+. Obrigado por contribuir.';toast('Relato enviado.');}
function openAdmin(){showModal('admin-modal');if(currentAdmin)renderAdmin();}
async function login(event){event.preventDefault();if(!db){$('#login-feedback').textContent='Configure o Supabase antes de entrar.';return;}const email=$('#login-email').value.trim(),password=$('#login-password').value;const button=$('#login-form button');button.disabled=true;const {data,error}=await db.auth.signInWithPassword({email,password});button.disabled=false;if(error){$('#login-feedback').textContent='Não foi possível entrar. Confira e-mail e senha.';return;}currentAdmin=data.user;await verifyAdmin();}
async function verifyAdmin(){if(!currentAdmin)return;const {data,error}=await db.from('profiles').select('role').eq('id',currentAdmin.id).single();if(error||data?.role!=='admin'){await db.auth.signOut();currentAdmin=null;$('#login-feedback').textContent='Esta conta não tem permissão de administração.';return;}renderAdmin();}
function renderAdmin(){const root=$('#admin-content');root.replaceChildren();root.append(el('span','eyebrow blue','PAINEL RESTRITO'));const title=el('h2','','Painel da equipe Acessa+');root.append(title);root.append(el('p','small-note',`Sessão: ${currentAdmin.email}`));const logout=el('button','button button-ghost','Sair');logout.type='button';logout.addEventListener('click',async()=>{await db.auth.signOut();currentAdmin=null;renderLogin();});root.append(logout);const tabs=el('div','admin-tabs');[['suggestions','Sugestões'],['reports','Relatos'],['places','Locais']].forEach(([key,label])=>{const b=el('button',adminTab===key?'active':'',label);b.type='button';b.addEventListener('click',()=>{adminTab=key;renderAdmin();});tabs.append(b);});root.append(tabs);const content=el('div','');content.id='admin-list';root.append(content);loadAdminTab(content);}
function renderLogin(){const root=$('#admin-content');root.replaceChildren();root.append(el('span','eyebrow blue','ACESSO RESTRITO'));root.append(el('h2','','Área da equipe'));root.append(el('p','','Entre com a conta autorizada pela administração do Acessa+.'));const form=el('form','form-card compact');form.id='login-form';const emailLabel=el('label','','E-mail');const email=el('input');email.type='email';email.id='login-email';email.autocomplete='username';email.required=true;emailLabel.append(email);const passLabel=el('label','','Senha');const pass=el('input');pass.type='password';pass.id='login-password';pass.autocomplete='current-password';pass.required=true;passLabel.append(pass);const submit=el('button','button button-primary','Entrar');submit.type='submit';const feedback=el('p','feedback','');feedback.id='login-feedback';form.append(emailLabel,passLabel,submit,feedback);form.addEventListener('submit',login);root.append(form);}
async function loadAdminTab(root){root.replaceChildren(el('div','loading','Carregando painel…'));let table=adminTab;let query=db.from(table).select('*').order('created_at',{ascending:false}).limit(100);if(table==='places')query=db.from('places').select('*').order('name');const {data,error}=await query;if(error){root.replaceChildren(el('div','empty','Não foi possível carregar esta lista.'));console.error(error);return;}root.replaceChildren();if(!data?.length){root.append(el('div','empty','Nenhum registro por aqui.'));return;}if(table==='suggestions')data.forEach(item=>root.append(suggestionAdminCard(item)));if(table==='reports')data.forEach(item=>root.append(reportAdminCard(item)));if(table==='places')data.forEach(item=>root.append(placeAdminCard(item)));}
function suggestionAdminCard(item){const card=el('article','admin-item');const place=places.find(p=>p.id===item.place_id);card.append(el('h3','',place?.name||'Local'));card.append(el('p','',`${FEATURES[item.feature_key]||item.feature_key}: ${item.suggested_status}`));card.append(el('p','',item.note));card.append(el('p','',`Contato: ${item.contact||'Não informado'} • Situação: ${item.review_status}`));if(item.review_status==='Pendente'){const actions=el('div','admin-actions');const approve=el('button','button button-primary','Aprovar e publicar');approve.type='button';approve.addEventListener('click',()=>approveSuggestion(item));const reject=el('button','button button-danger','Rejeitar');reject.type='button';reject.addEventListener('click',()=>updateSuggestionStatus(item.id,'Rejeitada'));actions.append(approve,reject);card.append(actions);}return card;}
function reportAdminCard(item){const card=el('article','admin-item');card.append(el('h3','',item.problem_type));card.append(el('p','',item.location_text));card.append(el('p','',item.description));const select=el('select');['Recebido','Em análise','Encaminhado ao responsável','Resolvido'].forEach(s=>select.add(new Option(s,s)));select.value=item.status;const save=el('button','button button-muted','Atualizar situação');save.type='button';save.addEventListener('click',async()=>{const {error}=await db.from('reports').update({status:select.value}).eq('id',item.id);if(error){toast('Não foi possível atualizar o relato.');return;}toast('Situação atualizada.');loadAdminTab($('#admin-list'));});card.append(el('p','',`Status atual: ${item.status}`),select,save);return card;}
function placeAdminCard(place){const card=el('article','admin-item');card.append(el('h3','',place.name));card.append(el('p','',place.address||'Endereço não informado'));const grid=el('div','');Object.entries(FEATURES).forEach(([key,label])=>{const wrap=el('label','',label);const select=el('select');STATUSES.forEach(s=>select.add(new Option(s,s)));select.value=(place.accessibility||{})[key]||'Não informado';select.dataset.feature=key;wrap.append(select);grid.append(wrap);});const save=el('button','button button-primary','Salvar recursos');save.type='button';save.addEventListener('click',async()=>{const accessibility={...(place.accessibility||{})};grid.querySelectorAll('select').forEach(s=>accessibility[s.dataset.feature]=s.value);const {error}=await db.from('places').update({accessibility,updated_at:new Date().toISOString()}).eq('id',place.id);if(error){toast('Não foi possível salvar.');return;}toast('Informações atualizadas para todos os usuários.');await loadPlaces();loadAdminTab($('#admin-list'));});card.append(grid,save);return card;}
async function approveSuggestion(item){const place=places.find(p=>p.id===item.place_id);if(!place){toast('Local não encontrado.');return;}const accessibility={...(place.accessibility||{}),[item.feature_key]:item.suggested_status};const update=await db.from('places').update({accessibility,updated_at:new Date().toISOString()}).eq('id',place.id);if(update.error){toast('Não foi possível atualizar o local.');return;}const review=await db.from('suggestions').update({review_status:'Aprovada'}).eq('id',item.id);if(review.error){toast('O local foi atualizado, mas não foi possível atualizar o status da sugestão. Confira o painel.');return;}toast('Sugestão aprovada e informação publicada.');await loadPlaces();loadAdminTab($('#admin-list'));}
async function updateSuggestionStatus(id,status){const {error}=await db.from('suggestions').update({review_status:status}).eq('id',id);if(error){toast('Não foi possível atualizar a sugestão.');return;}toast('Sugestão atualizada.');loadAdminTab($('#admin-list'));}

function init(){
  document.addEventListener('click',event=>{
    const close=event.target.closest('[data-close]');
    if(close)hideModal(close.dataset.close==='place'?'place-modal':'admin-modal');
  });

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      hideModal('place-modal');
      hideModal('admin-modal');
    }
  });

  $('#search').addEventListener('input',renderPlaces);
  $('#category-filter').addEventListener('change',renderPlaces);
  $('#voice-btn').addEventListener('click',toggleVoiceSearch);

  // Prepara o reconhecimento de voz
  setupVoiceSearch();

  $('#suggestion-form').addEventListener('submit',submitSuggestion);
  $('#report-form').addEventListener('submit',submitReport);
  $('#admin-open').addEventListener('click',openAdmin);
  $('#login-form').addEventListener('submit',login);

  if(!db){
    configWarning();
    return;
  }

  renderLogin();

  db.auth.getSession().then(({data})=>{
    if(data.session){
      currentAdmin=data.session.user;
      verifyAdmin();
    }
  });

  db.auth.onAuthStateChange((_event,session)=>{
    if(session){
      currentAdmin=session.user;
    }else{
      currentAdmin=null;
    }
  });

  loadPlaces();
}

document.addEventListener('DOMContentLoaded',init);
