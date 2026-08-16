import React, { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { Button, Spin, Tooltip } from '@arco-design/web-react';
import {
  IconBold, IconBrush, IconH1, IconH2, IconItalic, IconOrderedList,
  IconQuote, IconRedo, IconUndo, IconUnorderedList,
} from '@arco-design/web-react/icon';

export function RichTextEditor({ value, onChange, readOnly = false, streaming = false, onPolish }) {
  const [selection, setSelection] = useState(null);
  const valueRef = useRef(value || '');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      Markdown,
      Placeholder.configure({ placeholder: '从这里开始编辑正文...' }),
    ],
    content: value || '',
    contentType: 'markdown',
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      if (markdown === valueRef.current) return;
      valueRef.current = markdown;
      onChangeRef.current?.(markdown);
    },
    onSelectionUpdate: ({ editor: current }) => {
      if (readOnly) return setSelection(null);
      const { from, to } = current.state.selection;
      const selectedText = current.state.doc.textBetween(from, to, '\n').trim();
      if (!selectedText) return setSelection(null);
      const markdown = current.getMarkdown();
      const start = markdown.indexOf(selectedText);
      setSelection(start >= 0 ? { start, end: start + selectedText.length, selectedText } : null);
    },
  }, [readOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
    const nextValue = value || '';
    const current = editor.getMarkdown();
    valueRef.current = nextValue;
    if (current !== nextValue) editor.commands.setContent(nextValue, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value, readOnly]);

  if (!editor) return <div className="rich-editor-loading"><Spin size={18} /></div>;
  const tool = (label, icon, action, active = false, disabled = false) => <Tooltip key={label} content={label}><Button className={active ? 'is-active' : ''} type="text" size="mini" icon={icon} aria-label={label} disabled={disabled || readOnly} onClick={action} /></Tooltip>;
  return <div className={`rich-editor ${readOnly ? 'is-readonly' : ''} ${streaming ? 'is-candidate' : ''}`}>
    {!streaming && <div className="rich-editor-toolbar" role="toolbar" aria-label="正文格式">
      <span>{tool('粗体', <IconBold />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}{tool('斜体', <IconItalic />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}</span>
      <i />
      <span>
        {tool('一级标题', <IconH1 />, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
        {tool('二级标题', <IconH2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {tool('无序列表', <IconUnorderedList />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {tool('有序列表', <IconOrderedList />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {tool('引用', <IconQuote />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
      </span>
      <i />
      <span>{tool('撤销编辑', <IconUndo />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}{tool('重做编辑', <IconRedo />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}</span>
    </div>}
    <div className="rich-editor-canvas"><EditorContent editor={editor} aria-label={streaming ? 'AI 流式改写候选' : '生成的文案'} /></div>
    {selection && onPolish && <div className="selection-polish" role="toolbar" aria-label="选中内容 AI 操作">
      <Button size="mini" icon={<IconBrush />} onMouseDown={(event) => event.preventDefault()} onClick={() => onPolish('de_ai', selection)}>润色</Button>
      <Button size="mini" onMouseDown={(event) => event.preventDefault()} onClick={() => onPolish('concise', selection)}>精简</Button>
      <Button size="mini" onMouseDown={(event) => event.preventDefault()} onClick={() => onPolish('natural', selection)}>更自然</Button>
    </div>}
  </div>;
}
