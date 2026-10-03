(()=>{
'use strict';
const form=document.getElementById('filters'),search=document.getElementById('search'),country=document.getElementById('country'),priority=document.getElementById('priority'),count=document.getElementById('result-count'),empty=document.getElementById('no-results');
const fold=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLocaleLowerCase();
const cards=[...document.querySelectorAll('.programme-card')].map(element=>({element,text:fold(element.textContent)}));
function filter(){
 const terms=fold(search.value.trim()).split(/\s+/).filter(Boolean);let shown=0;
 cards.forEach(({element,text})=>{const match=terms.every(term=>text.includes(term))&&(!country.value||element.dataset.country===country.value)&&(!priority.value||element.dataset.priority===priority.value);element.hidden=!match;if(match)shown++;});
 count.textContent=shown+' of '+cards.length+' routes shown';empty.hidden=shown!==0;
}
form.hidden=false;
form.addEventListener('submit',event=>event.preventDefault());
search.addEventListener('input',filter);country.addEventListener('change',filter);priority.addEventListener('change',filter);
form.addEventListener('reset',()=>requestAnimationFrame(filter));
document.querySelector('.reset-all').addEventListener('click',()=>{form.reset();search.focus();});
filter();
})();
