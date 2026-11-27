"use client";

/** Pristupačan izbor s nativnom kontrolom za FormData i validaciju. Opcije se
 * unose kao <option>, pa postojeći ugovori i vrijednosti ne mijenjaju oblik. */
import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Field } from "./controls";

type Option = { value:string; label:string; disabled:boolean };
function textOf(node:ReactNode):string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{children?:ReactNode}>(node)) return textOf(node.props.children);
  return "";
}
function parseOptions(children:ReactNode, parentDisabled = false):Option[] {
  const result:Option[]=[];
  Children.forEach(children, child=>{
    if (!isValidElement<{value?:string|number;disabled?:boolean;children?:ReactNode}>(child)) return;
    if (child.type === "option") {
      const label=textOf(child.props.children).trim();
      result.push({value:String(child.props.value ?? label),label,disabled:parentDisabled || !!child.props.disabled});
    } else if (child.type === Fragment || child.type === "optgroup") result.push(...parseOptions(child.props.children,parentDisabled || !!child.props.disabled));
  });
  return result;
}

type Props = SelectHTMLAttributes<HTMLSelectElement> & {label?:string;hint?:string;searchThreshold?:number};
export function SelectField({id,label,hint,children,value,defaultValue,onChange,disabled,required,name,searchThreshold=8,...props}:Props) {
  const generated=useId(); const inputId=id ?? generated; const listId=`${generated}-list`;
  const options=parseOptions(children);
  const [local,setLocal]=useState(String(defaultValue ?? options[0]?.value ?? ""));
  const chosen=String(value ?? local);
  const [open,setOpen]=useState(false); const [query,setQuery]=useState(""); const [active,setActive]=useState(0);
  const [invalid,setInvalid]=useState(false); const [style,setStyle]=useState<CSSProperties | null>(null);
  const button=useRef<HTMLButtonElement>(null); const native=useRef<HTMLSelectElement>(null); const menu=useRef<HTMLDivElement>(null);
  const search=useRef<HTMLInputElement>(null); const showSearch=options.length>=searchThreshold;
  const filtered=options.filter(option=>option.label.toLocaleLowerCase("bs").includes(query.trim().toLocaleLowerCase("bs")));
  const selected=options.find(option=>option.value===chosen);
  const activeOption=filtered[active];
  const portal=button.current?.closest('[role="dialog"]') ?? (typeof document !== "undefined" ? document.body : null);
  function openMenu(){
    if(disabled) return;
    setQuery("");
    const index=options.findIndex(option=>option.value===chosen && !option.disabled);
    setActive(index >= 0 ? index : Math.max(0, options.findIndex(option=>!option.disabled)));
    setOpen(true);
  }
  function choose(option:Option|undefined){
    if(!option || option.disabled || !native.current) return;
    native.current.value=option.value;
    native.current.dispatchEvent(new Event("change",{bubbles:true}));
    setInvalid(false); setOpen(false); button.current?.focus();
  }
  function move(direction:number){
    if (!filtered.length) return;
    let next=active;
    for(let i=0;i<filtered.length;i++){next=(next+direction+filtered.length)%filtered.length;if(!filtered[next]?.disabled){setActive(next);break;}}
  }
  function blur(event:React.FocusEvent) {
    const next=event.relatedTarget as Node | null;
    if (next && !button.current?.contains(next) && !menu.current?.contains(next)) setOpen(false);
  }
  function keys(event:React.KeyboardEvent){
    if(event.key === "Escape" && open){event.preventDefault();event.stopPropagation();setOpen(false);button.current?.focus();}
    else if(event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault();if(!open)openMenu();else move(event.key === "ArrowDown" ? 1 : -1);}
    else if(event.key === "Enter" && open){event.preventDefault();choose(activeOption);}
    else if(event.key === "Home" && open){event.preventDefault();setActive(Math.max(0,filtered.findIndex(x=>!x.disabled)));}
    else if(event.key === "End" && open){event.preventDefault();const reversedIndex=[...filtered].reverse().findIndex(x=>!x.disabled);if(reversedIndex>=0)setActive(filtered.length-1-reversedIndex);}
  }
  useLayoutEffect(()=>{
    if(!open || !button.current)return;
    const place=()=>{
      const rect=button.current?.getBoundingClientRect();if(!rect)return;
      const edge=8, gap=6, below=window.innerHeight-rect.bottom-edge, above=rect.top-edge;
      const up=below<220 && above>below;
      const maxHeight=Math.max(100,Math.min(320,up ? above-gap : below-gap));
      setStyle({position:"fixed",left:Math.max(edge,Math.min(rect.left,window.innerWidth-rect.width-edge)),width:Math.min(rect.width,window.innerWidth-edge*2),top:up ? rect.top-gap : rect.bottom+gap,transform:up ? "translateY(-100%)" : undefined,maxHeight,zIndex:80});
    };
    place();window.addEventListener("resize",place);document.addEventListener("scroll",place,true);
    return ()=>{window.removeEventListener("resize",place);document.removeEventListener("scroll",place,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    function outside(event:MouseEvent){const target=event.target as Node;if(!button.current?.contains(target) && !menu.current?.contains(target))setOpen(false);}
    document.addEventListener("mousedown",outside);return ()=>document.removeEventListener("mousedown",outside);
  },[open]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  useEffect(()=>{if(open && style && showSearch) search.current?.focus();},[open,style !== null,showSearch]);
  useEffect(()=>{
    const form=native.current?.form;
    if(!form || value !== undefined)return;
    const reset=()=>queueMicrotask(()=>setLocal(native.current?.value ?? ""));
    form.addEventListener("reset",reset);return ()=>form.removeEventListener("reset",reset);
  },[value]);
  useEffect(()=>{if(open) document.getElementById(`${generated}-option-${active}`)?.scrollIntoView?.({block:"nearest"});},[open,active,generated]);
  const field=<>
    <div className="gx-select-field">
      <button id={inputId} ref={button} type="button" className="gx-input gx-select-field__trigger" role="combobox" aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-activedescendant={open && activeOption ? `${generated}-option-${active}` : undefined} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={[props["aria-describedby"],hint ? `${inputId}-hint` : undefined].filter(Boolean).join(" ") || undefined} disabled={disabled} onClick={()=>open ? setOpen(false) : openMenu()} onKeyDown={keys} onBlur={blur}>
        <span>{selected?.label ?? "Odaberite"}</span><span aria-hidden="true">⌄</span>
      </button>
      <select {...props} ref={native} className="gx-select-field__native" tabIndex={-1} aria-hidden="true" name={name} disabled={disabled} required={required} value={value === undefined ? undefined : value} defaultValue={value === undefined ? defaultValue : undefined} onChange={event=>{setLocal(event.currentTarget.value);onChange?.(event);}} onInvalid={event=>{event.preventDefault();setInvalid(true);button.current?.focus();}}>{children}</select>
      {invalid ? <p className="gx-field__hint gx-select-field__error" role="alert">Odaberite vrijednost.</p> : null}
    </div>
    {open && portal && style ? createPortal(<div ref={menu} className="gx-select-field__menu" style={style}>
      {showSearch ? <input ref={search} type="search" className="gx-input gx-select-field__search" aria-label="Pretraži opcije" aria-controls={listId} aria-activedescendant={activeOption ? `${generated}-option-${active}` : undefined} placeholder="Traži…" value={query} onChange={event=>{setQuery(event.target.value);const first=options.findIndex(option=>!option.disabled && option.label.toLocaleLowerCase("bs").includes(event.target.value.trim().toLocaleLowerCase("bs")));setActive(first < 0 ? 0 : options.slice(0,first).filter(option=>option.label.toLocaleLowerCase("bs").includes(event.target.value.trim().toLocaleLowerCase("bs"))).length);}} onKeyDown={keys} onBlur={blur} /> : null}
      <div role="listbox" id={listId} aria-label={label ? `Opcije: ${label}` : "Opcije"} className="gx-select-field__options">
        {filtered.map((option,index)=><div id={`${generated}-option-${index}`} key={`${option.value}-${index}`} role="option" aria-selected={option.value===chosen} aria-disabled={option.disabled || undefined} className={`gx-select-field__option${index===active ? " gx-select-field__option--active" : ""}`} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>{if(!option.disabled)setActive(index);}} onClick={()=>choose(option)}>{option.label}{option.value===chosen ? <span aria-hidden="true">✓</span> : null}</div>)}
        {!filtered.length ? <p className="gx-page-sub">Nema rezultata.</p> : null}
      </div>
    </div>,portal) : null}
  </>;
  return label ? <Field label={label} htmlFor={inputId} hint={hint}>{field}</Field> : field;
}
