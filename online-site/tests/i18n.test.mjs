import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
function workspace(language='bn') {
 const nodes=[], attributes=[];
 const root={querySelectorAll:()=>[]};
 const doc={body:root,documentElement:{lang:''},addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null,createTreeWalker:()=>{let index=0;return {nextNode:()=>nodes[index++]||null};}};
 const context=vm.createContext({document:doc,window:{dispatchEvent(){}},localStorage:{getItem:()=>language,setItem(){}},Intl,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){}disconnect(){}},CustomEvent:class{},queueMicrotask});
 for(const filename of ['i18n-catalog.js','i18n.js'])vm.runInContext(readFileSync(new URL('../public/'+filename,import.meta.url),'utf8'),context);
 return {i18n:context.window.AppI18n,nodes,attributes};
}
test('language changes are reversible for labels, dynamic numbers and validation',()=>{
 const {i18n,nodes}=workspace();const label={data:'Save Sale',parentElement:{closest:()=>false}};nodes.push(label);i18n.apply();assert.equal(label.data,'বিক্রি সংরক্ষণ');i18n.setLanguage('en');assert.equal(label.data,'Save Sale');label.data='Save Changes';i18n.apply();assert.equal(label.data,'Save Changes');i18n.setLanguage('bn');assert.equal(label.data,'পরিবর্তন সংরক্ষণ');assert.equal(i18n.text('60টির মধ্যে 4টি দেখানো হচ্ছে'),'৬০টির মধ্যে ৪টি দেখানো হচ্ছে');assert.equal(i18n.text('Quantity must be a whole number greater than zero.'),'পরিমাণ শূন্যের চেয়ে বড় পূর্ণসংখ্যা হতে হবে।');i18n.setLanguage('en');assert.equal(i18n.text('৬০টির মধ্যে ৪টি দেখানো হচ্ছে'),'4 of 60 records');
});
test('record names and draft values stay separate from translated labels',()=>{
 const {i18n,nodes}=workspace();const name={data:'Cash',parentElement:{closest:()=>true}};nodes.push(name);i18n.apply();assert.equal(name.data,'Cash');assert.equal(i18n.text('Edit Cash Starter 25kg'),'Cash Starter 25kg সম্পাদনা');assert.equal(i18n.format('Delete {entity}: {name}?',{entity:'কাস্টমার',name:'Sales'}),'কাস্টমার থেকে Sales মুছবেন?');i18n.setLanguage('en');assert.equal(name.data,'Cash');assert.equal(i18n.format('Edit {name}',{name:'বিক্রি'}),'Edit বিক্রি');
});
