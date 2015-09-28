(function() {
    'use strict';

    var now = Date.now || function() {
        return new Date().getTime();
    };

    var reUnescapedHtml = /[&<>"'`]/g;
    var reHasUnescapedHtml = RegExp(reUnescapedHtml.source);
    var isTextInserted;
    var htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
    var quotationChar = '>';
    var nodeTypes = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
    var bounds = { BLOCK: 1, INLINE: 2 };


    /**
     * Событие срабатывает при переключении режима оформления
     * @event switchmode:switched
     * @member CKEDITOR.editor
     */

    /**
     * Debounce событие срабатывает при клике мыши или нажатии кнопки в режиме ввода без оформления
     * @event switchmode:savebookmark
     * @member CKEDITOR.editor
     */

    /**
     * Подтверждение переключения режима оформления
     * @param {function} resolve
     * @param {function} reject
     */
    CKEDITOR.config.switchmodeConfirm = function(resolve, reject) {
        resolve = resolve || function() {};
        reject = reject || function() {};

        if (window.confirm(this.lang.switchmode.confirm)) {
            resolve.call(this);
        } else {
            reject.call(this);
        }
    };

    /**
     * Необходимость подтверждения переключения режима оформления
     * @type {Boolean}
     */
    CKEDITOR.config.needToConfirmSwitchmode = true;

    /**
     * Задержка debounce события switchmode:savebookmark в ms
     * @type {Number}
     */
    CKEDITOR.config.switchmodeSavebookmarkDebounce = 500;

    CKEDITOR.plugins.add('switchmode', {
        modes: { wysiwyg: 1, source: 1 },
        requires: 'exbutton',

        onLoad: function() {
            CKEDITOR.addCss(
                '.cke_switchmode_editable_vhidden {visibility:hidden;}'
            );

            CKEDITOR.plugins.setLang('switchmode', 'ru', {
                'disable': 'Отключить оформление',
                'enable': 'Оформить письмо',
                'confirm': 'Форматирование текста и изображения будут потеряны.'
            });
        },

        init: function(editor) {
            var lang = editor.lang.switchmode;

            this.onKeyupSourceDebounce = debounce(this.onKeyupSource, editor.config.switchmodeSavebookmarkDebounce);

            editor.addCommand('switchmode', {
                modes: { wysiwyg: 1, source: 1 },
                editorFocus: false,
                readOnly: 1,
                exec: this.onExecSwitchmode.bind(editor)
            });

            editor.ui.addButton('SwitchMode', {
                label: lang.disable,
                title: lang.disable,
                command: 'switchmode'
            });

            editor.on('loaded', this.onLoaded);
            editor.on('mode', this.onMode);
            editor.on('beforeSetMode', this.onBeforeSetMode);
            editor.on('destroy', this.onDestroy);

            editor._switchmodePreviousData = '';
        },

        /**
         * @this {Editor}
         */
        onLoaded: function() {
            // Чистка оформления html для правильного формирования plain
            var writer = this.dataProcessor.writer;
            writer.indentationChars = '';
            writer.lineBreakChars = '';
            writer.sortAttributes = false;

            var dtd = CKEDITOR.dtd;
            var tags = CKEDITOR.tools.extend({}, dtd.$block, dtd.$listItem, dtd.$tableContent);

            for (var tagName in tags) {
                writer.setRules(tagName, {
                    'indent': false,
                    'breakBeforeOpen': false,
                    'breakAfterOpen': false,
                    'breakBeforeClose': false,
                    'breakAfterClose': false
                });
            }
        },

        /**
         * @this {Editor}
         */
        onDestroy: function() {
            this._switchmodePreviousData = '';

            var plugin = this.plugins.switchmode;
            plugin.onKeyupSourceDebounce.cancel();
        },

        /**
         * @this {Editor}
         */
        onBeforeSetMode: function() {
            if (!this.mode) {
                return;
            }

            this.fire('saveSnapshot');
            this.fire('lockSnapshot');

            // скрываем блок с контентом, чтобы не видеть мигания тегов
            this.ui.space('contents').addClass('cke_switchmode_editable_vhidden');

            this._isSwitchmodeStartTransaction = true;
            this._switchmodePreviousData = this.getData();

            // дикий ХАК
            // в вебките какой-то обработчик click'а по кнопке переключения режима
            // успевает захватить plain содержимое редактора и обработать его как html без экранирования
            // в результате грузит всякие img
            this.setData('', { 'noSnapshot': true });
        },

        /**
         * @this {Editor}
         */
        onMode: function() {
            var isSource = (this.mode === 'source');
            var buttonState = (isSource ? CKEDITOR.TRISTATE_ON : CKEDITOR.TRISTATE_OFF);
            var plugin = this.plugins.switchmode;
            var lang = this.lang.switchmode;
            var button = this.ui.get('SwitchMode');
            var title = (isSource ? lang.enable : lang.disable);

            button.setState(buttonState)
            button.setTitle(title);
            button.setLabel(title);

            if (isSource) {
                var editable = this.editable();
                editable.attachListener(editable, 'input', plugin.onInputSource.bind(this));
                editable.attachListener(editable, 'mouseup', plugin.onMouseupSource.bind(this));
                editable.attachListener(editable, 'keyup', plugin.onKeyupSourceDebounce.bind(this));

            } else {
                plugin.onKeyupSourceDebounce.cancel();
            }

            if (this._isSwitchmodeStartTransaction) {
                var message = this._switchmodePreviousData;

                if (isSource) {
                    message = html2text(message);
                    message = trimRight(message);

                } else {
                    // Заменяем двойные пробелы на "&nbsp; "
                    message = message.replace(/\u0020\u0020/g, '\u00a0 ');
                    message = text2html(message);
                }

                this.setData(message, {
                    'callback': plugin.onModeSetData
                });
            }

            this._switchmodePreviousData = '';
        },

        /**
         * @this {Editor}
         */
        onModeSetData: function() {
            this.ui.space('contents').removeClass('cke_switchmode_editable_vhidden');

            this._isSwitchmodeStartTransaction = false;

            this.fire('unlockSnapshot');
            this.fire('switchmode:switched');

            setTimeout(this.plugins.switchmode.onRestoreFocus.bind(this), 0);
        },

        onRestoreFocus: function() {
            this.focus();

            // текстарея после подстановки данных ставит каретку в конец текста
            // переносим каретку и скрол в начало
            // TODO переделать на методы ckeditor
            if (this.mode === 'source') {
                var editable = this.editable().$;
                setSelection(editable, 0);
                editable.scrollTop = 0;
            }
        },

        /**
         * @param {CKEDITOR.eventInfo} event
         * @this {Editor}
         */
        onInputSource: function(event) {
            this.fire('change', event.data);
        },

        /**
         * @this {Editor}
         */
        onMouseupSource: function() {
            this.fire('switchmode:savebookmark');
        },

        /**
         * @this {Editor}
         */
        onKeyupSource: function() {
            this.fire('switchmode:savebookmark');
        },

        /**
         * @this {Editor}
         */
        onExecSwitchmode: function() {
            if (this.undoManager.locked) {
                return;
            }

            var newMode = 'wysiwyg';
            var confirm = function(resolve) {
                resolve.call(this);
            }.bind(this);

            if (this.mode === 'wysiwyg') {
                newMode = 'source';

                if (this.config.needToConfirmSwitchmode) {
                    // учитываем картинки как текст
                    // для этого заменяем тег картинок на текст
                    var message = this.getData().replace(/<img.*\/>/ig, 'img');
                    message = html2text(message);

                    // \s is the same as [\f\n\r\t\u000B\u0020\u00A0\u2028\u2029].
                    // This is a partial set of Unicode whitespace characters.
                    // \S is the opposite: [^\f\n\r\t\u000B\u0020\u00A0\u2028\u2029].
                    if (/\S/.test(message)) {
                        confirm = debounce(this.config.switchmodeConfirm.bind(this), 0);
                    }
                }
            }

            confirm(function() {
                this.setMode(newMode);
            });
        }
    });

    function debounce(func, wait, immediate) {
        var timeout, args, context, timestamp, result;

        var later = function() {
            var last = now() - timestamp;

            if (last < wait && last >= 0) {
                timeout = setTimeout(later, wait - last);

            } else {
                timeout = null;
                if (!immediate) {
                    result = func.apply(context, args);
                    if (!timeout) {
                        context = args = null;
                    }
                }
            }
        };

        var _debounce = function() {
            context = this;
            args = arguments;
            timestamp = now();

            var callNow = immediate && !timeout;
            if (!timeout) {
                timeout = setTimeout(later, wait);
            }

            if (callNow) {
                result = func.apply(context, args);
                context = args = null;
            }

            return result;
        };

        _debounce.cancel = function() {
            clearTimeout(timeout);
            context = args = null;
        };

        return _debounce;
    }

    function trimRight(string) {
        string = String(string || '');
        if (!string) {
            return string;
        }

        return string.slice(0, trimmedRightIndex(string) + 1);
    }

    function trimmedRightIndex(string) {
        var index = string.length;
        while (index-- && isSpace(string.charCodeAt(index))) {}
        return index;
    }

    function isSpace(charCode) {
        return ((charCode <= 160 && (charCode >= 9 && charCode <= 13) || charCode == 32 || charCode == 160) || charCode == 5760 || charCode == 6158 ||
            (charCode >= 8192 && (charCode <= 8202 || charCode == 8232 || charCode == 8233 || charCode == 8239 || charCode == 8287 || charCode == 12288 || charCode == 65279)));
    }

    function text2html(text, wrapperTag) {
        wrapperTag = wrapperTag || 'div';
        var open = '<' + wrapperTag + '>';
        var close = '</' + wrapperTag + '>';

        // чтобы не заэскейпить &nbsp; еще раз, делаем replace после
        var html = escape(text).replace(/^--[\u0020\u00a0]$/gm, '--&nbsp;');
        html = open + html + close;
        html = html.replace(/\n/g, close + open);
        return html;
    }

    function html2text(value) {
        if (!value) {
            return '';
        }

        var DOMContainer = document.implementation.createHTMLDocument('').body;
        DOMContainer.innerHTML = value;

        isTextInserted = false;

        var preProcessed = [];
        convertChildNodes(DOMContainer, preProcessed);
        var result = joinEntries(preProcessed);

        return result
            .replace(/^[\u0020\u00a0]+$/gm, '')
            .replace(/^\n/, '')
            .replace(/\n$/, '');
    }

    function convertChildNodes(node, buffer) {
        for (var i = 0; i < node.childNodes.length; ++i) {
            convertNode(node.childNodes[i], buffer);
        }
    }

    function convertNode(node, buffer) {
        var entities;

        if (node.nodeType === nodeTypes.ELEMENT_NODE) {
            var element = new CKEDITOR.dom.element(node);

            if (element.is('blockquote')) {
                concat(buffer, bounds.BLOCK);
                entities = [];
                convertChildNodes(node, entities);
                concat(buffer, bounds.BLOCK, quoteText(joinEntries(entities)), bounds.BLOCK);
                return;
            }

            if (element.hasClass('normalize')) {
                entities = [];
                convertChildNodes(node, entities);
                concat(buffer, normalize(joinEntries(entities)), bounds.BLOCK);
                return;
            }

            var tagName = node.tagName.toLowerCase();

            switch (tagName) {
                case 'h1':
                case 'h2':
                case 'h3':
                case 'h4':
                case 'h5':
                case 'h6':
                case 'pre':
                case 'p':
                case 'ol':
                case 'ul':
                case 'dl':
                case 'table':
                    if (isTextInserted || isBufferContainText(buffer)) {
                        concat(buffer, bounds.BLOCK, '', bounds.BLOCK);
                    } else {
                        concat(buffer, bounds.BLOCK);
                        isTextInserted = true;
                    }

                    convertChildNodes(node, buffer);
                    concat(buffer, bounds.BLOCK);
                    return;

                case 'div':
                case 'address':
                case 'fieldset':
                case 'form':
                case 'dt':
                case 'dd':
                case 'tr':
                    concat(buffer, bounds.BLOCK);
                    convertChildNodes(node, buffer);
                    concat(buffer, bounds.BLOCK);
                    return;

                case 'br':
                    concat(buffer, '', bounds.BLOCK);
                    return;

                case 'hr':
                    concat(buffer, bounds.BLOCK, '----------------------------------------', bounds.BLOCK);
                    return;

                case 'li':
                    concat(buffer, bounds.BLOCK, '* ');
                    convertChildNodes(node, buffer);
                    concat(buffer, bounds.BLOCK);
                    return;

                case 'td':
                case 'th':
                    concat(buffer, bounds.INLINE);
                    convertChildNodes(node, buffer);
                    concat(buffer, bounds.INLINE);
                    return;

                default:
                    convertChildNodes(node, buffer);
                    return;
            }

        } else if (node.nodeType === nodeTypes.TEXT_NODE) {
            concat(buffer, node.data.replace(/[\u0020\n\r\t]+/g, ' '));
        }
    }

    function joinEntries(entries) {
        var prev;
        var elem;
        var i;
        var filtered = [];
        var filtered2 = [];

        prev = entries[0] || '';
        filtered.push(prev);
        for (i = 1; i < entries.length; ++i) {
            elem = entries[i];

            if (elem === bounds.INLINE && (prev === bounds.INLINE || prev === bounds.BLOCK)) {
                continue;
            } else if (elem === bounds.BLOCK && prev === bounds.INLINE) {
                filtered[filtered.length - 1] = bounds.BLOCK;
                prev = bounds.BLOCK;
            } else {
                filtered.push(elem);
                prev = elem;
            }
        }

        prev = filtered[0] || '';
        filtered2.push(prev);

        for (i = 1; i < filtered.length; ++i) {
            elem = filtered[i];

            if (!(elem === bounds.BLOCK && prev === bounds.BLOCK)) {
                prev = elem;
                filtered2.push(elem);
            }
        }

        for (i = 0; i < filtered2.length; ++i) {
            if (filtered2[i] === bounds.BLOCK) {
                filtered2[i] = '\n';

            } else if (filtered2[i] === bounds.INLINE) {
                filtered2[i] = ' ';
            }
        }
        return filtered2.join('');
    }

    function concat(buffer) {
        for (var i = 1; i < arguments.length; i++) {
            var argument = arguments[i];
            if (Array.isArray(argument)) {
                Array.prototype.push.apply(buffer, argument);
            } else {
                buffer.push(argument);
            }
        }
    }

    function quoteText(value) {
        value = normalize(value);

        return value.replace(/^.?/gm, function(c) {
            if (c === quotationChar) {
                return quotationChar + c;
            } else if (c) {
                return quotationChar + ' ' + c;
            } else {
                return quotationChar;
            }
        });
    }

    function normalize(text) {
        // Заменяем пробельные последовательности на одиночный пробел
        text = text.replace(/\u0020+/g, ' ')
            // Удаляем пробелы на началах и концах строк
            .replace(/^\u0020+|[\u0020\u00a0]+$/gm, '')
            // Не разрешаем более двух переносов строки
            .replace(/\n{3,}/g, '\n\n')
            // Удаляем пробельные последовательности в начале и конце полученного текста
            .replace(/^[\u0020\n\r\t]+|[\u0020\u00a0\n\r\t]+$/g, '');

        return text;
    }

    function escape(string) {
        string = String(string || '');
        return (string && reHasUnescapedHtml.test(string))
            ? string.replace(reUnescapedHtml, escapeHtmlChar)
            : string;
    }

    function escapeHtmlChar(chr) {
        return htmlEscapes[chr];
    }

    function isBufferContainText(buffer) {
        for (var i = 0; i < buffer.length; i++) {
            if (buffer[i].length) {
                return true;
            }
        }

        return false;
    }

    function setSelection(field, start, end) {
        start = start || 0;
        end = end || start;

        if (field.setSelectionRange) {
            field.setSelectionRange(start, end);

        } else if (field.createTextRange) {
            var range = field.createTextRange();
            range.collapse(true);
            range.moveStart('character', start);
            range.moveEnd('character', end - start);
            range.select();
        }
    }

}());
