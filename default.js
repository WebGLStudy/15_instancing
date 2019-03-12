(function(){
    'use strict';
    
    const INSTANCE_COUNT = 512;
    const TREE_RANGE = 100.0;

    // 変数
    let gl, canvas;
    let program_bg, program_scene, program_post;
    
    let envMap = {tex:null};// 環境マップ
    let treeTex = {tex:null};// 木の画像
    let mesh_full_screen;
    let mesh_tree;
    
    // カメラ操作用
    let is_dragging = false; // ドラッグ判定
    let client0 = {x: 0.5, y: 0.5}; // ドラッグ前のカーソルの位置
    let angle = {x: 0.25, y: 0.0};// カメラに送る角度
    let angle0 = {x: 0.0, y: 0.0};// ドラッグ前の確度を保存する

    window.addEventListener('load', function(){
        ////////////////////////////
        // 初期化
        ////////////////////////////
        
        // canvas の初期化
        canvas = document.getElementById('canvas');
        canvas.width = 960;
        canvas.height = 540;
        
        ////////////////////////////
        // ドラッグ処理
        
        // ドラッグ開始
        function onMouseDown(e) {
            is_dragging = true; // フラグを立てる
            client0.x = e.clientX;// カーソル位置を保存
            client0.y = e.clientY;
            angle0.x = angle.x;// カメラ角度を保存
            angle0.y = angle.y;
        }
        canvas.addEventListener('mousedown', onMouseDown, false);

        // ドラッグの終了
        function onMouseUp(e) {
            is_dragging = false;
        }
        canvas.addEventListener('mouseup', onMouseUp, false);

        // マウスカーソルを動かしたとき
        function mouseMove(e){
            if(is_dragging) {
                // 動かした後のカメラ位置をドラッグ開始位置を基に求める
                angle.x = angle0.x - (0.2/canvas.width ) * (e.clientX - client0.x);
                angle.y = angle0.y + (0.2/canvas.height) * (e.clientY - client0.y);
            }
        }
        canvas.addEventListener('mousemove', mouseMove, false);
        
        ////////////////////////////
        // WeebGLの初期化(WebGL 2.0)
        gl = canvas.getContext('webgl2');
        
        // 浮動小数点数レンダーターゲットの確認
        if(gl.getExtension('EXT_color_buffer_float') == null){
            alert('float texture not supported');
            return;
        }
        
        ////////////////////////////
        // プログラムオブジェクトの初期化
        
        // 背景用シェーダ
        const vsSourceBg = [
            '#version 300 es',
            'in vec3 position;',
            
            'uniform mat4 mpvMatrixInv;',// ビュー射影行列の逆行列

            'out vec4 vPos;',

            'void main(void) {',
                'gl_Position = vec4(position, 1.0);',
                'vPos = mpvMatrixInv * gl_Position;',// クリップ空間からワールド空間の座標を導出
            '}'
        ].join('\n');

        const fsSourceBg = [
            '#version 300 es',
            'precision highp float;',
            
            'in vec4 vPos;',
            
            'uniform vec3 camera_pos;',
            'uniform samplerCube sampCube;',

            'out vec4 outColor;',

            'void main(void) {',
                'vec3 eye_dir = (vPos.xyz/vPos.w - camera_pos) * vec3(-1,1,1);',
                'outColor  = vec4(texture(sampCube, eye_dir).rgb, 1.0);',
            '}'
        ].join('\n');

        // シーン描画用シェーダ
        const vsSourceScene = [
            '#version 300 es',
            'in vec3 position;',
            'in vec2 uv;',
            'in vec4 instance_data;',// x,y,z, scale
           
            'uniform mat4 mwMatrix;',
            'uniform mat4 mpvMatrix;',
            
            'out vec2 vUv;',

            'void main(void) {',
                'vec4 wpos = mwMatrix * vec4(position, 1.0);',
                'wpos.xyz = wpos.xyz * instance_data.w + instance_data.xyz;',// インスタンスの配置と拡縮
                'gl_Position = mpvMatrix * wpos;',// 画面に表示される位置
                'vUv = uv;',
            '}'
        ].join('\n');

        const fsSourceScene = [
            '#version 300 es',
            'precision highp float;',

            'in vec2 vUv;',
            
            'uniform sampler2D samp;',

            'out vec4 outColor;',

            'void main(void) {',
                'vec4 tex = texture(samp, vUv);',
                
                'if(tex.a == 0.0){',// 完全に透明なら深度を書き込まないように捨てる
                '     discard;',
                '}',

                'outColor = vec4(0.1 * tex.xyz, tex.a);',// 背景と合わせるため暗くした
            '}'
        ].join('\n');

        // ポストエフェクト
        const vsSourceFullScreen = [
            '#version 300 es',
            'in vec3 position;',
            'in vec2 uv;',
            
            'out vec2 vUv;',

            'void main(void) {',
                'gl_Position = vec4(position, 1.0);',
                'vUv = uv;',
            '}'
        ].join('\n');

        const fsSourcePost = [
            '#version 300 es',
            'precision highp float;',
            
            'in vec2 vUv;',
            
            'uniform sampler2D samp;',

            'out vec4 outColor;',

            'float A = 0.15;',
            'float B = 0.50;',
            'float C = 0.10;',
            'float D = 0.20;',
            'float E = 0.02;',
            'float F = 0.30;',
            'vec3 Uncharted2Tonemap(vec3 x)',
            '{',
            '   return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;',
            '}',
            'float Uncharted2Tonemap(float x)',
            '{',
            '   return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;',
            '}',
            'float Uncharted2WhiteScale(){',
            '   float W = 11.2;',
            '   return 1.0 / Uncharted2Tonemap(W);',
            '}',

            'void main(void) {',
                'vec3 col = texture(samp, vUv).rgb;',
                // トーンマッピング http://filmicworlds.com/blog/filmic-tonemapping-operators/
                'float ExposureBias = 10.0f;',
                'col = Uncharted2Tonemap(ExposureBias * col) * Uncharted2WhiteScale();',
                // ガンマ補正
                'float g = 1.0/2.2;',
                'col  = pow(col, vec3(g,g,g));',
                'outColor  = vec4(col, 1.0);',
            '}',

        ].join('\n');

        // シェーダ「プログラム」の初期化
        program_bg    = create_program(vsSourceBg,         fsSourceBg,    ['sampCube', 'mpvMatrixInv', 'camera_pos']);
        program_scene = create_program(vsSourceScene,      fsSourceScene, ['mwMatrix', 'mpvMatrix', 'samp']);
        program_post  = create_program(vsSourceFullScreen, fsSourcePost,  ['samp']);

        ////////////////////////////
        // フレームバッファオブジェクトの取得
        let floatBuffer = create_framebuffer(canvas.width, canvas.height);

        ////////////////////////////
        // テクスチャの読み込み
        
        // 環境マップ
        create_cube_texture([
            'img/xp.hdr',
            'img/xn.hdr',
            'img/yp.hdr',
            'img/yn.hdr',
            'img/zp.hdr',
            'img/zn.hdr'],
            envMap);

        // 木の画像
        create_texture('img/tree223 copia.png', treeTex);

        ////////////////////////////
        // モデルの構築
        
        // 木のモデル
        let instanceData = [];
        (function(){
            for(let i = 0; i < INSTANCE_COUNT; i++){
                let x = (Math.random() - 0.5) * TREE_RANGE;// [-TREE_RANGE/2, +TREE_RANGE/2]
                let z = (Math.random() - 0.5) * TREE_RANGE;// [-TREE_RANGE/2, +TREE_RANGE/2]
                let scale = Math.random() * 3.0 + 0.3;// [0.3, 3.3]
                instanceData.push(x, 0.0, z, scale);
            }
        })();
        mesh_tree = createMeshInstanced(gl, program_scene.prg, [
            //   x          y         z      u    v 
             +1.0*1.234, 0.0*1.600, 0.0,   1.0, 1.0,
             +1.0*1.234, 2.0*1.600, 0.0,   1.0, 0.0,
             -1.0*1.234, 0.0*1.600, 0.0,   0.0, 1.0,
             -1.0*1.234, 2.0*1.600, 0.0,   0.0, 0.0,
        ], [
            0,1,2,  3,2,1,
        ], instanceData);
        
        // 全画面を覆う三角形
        mesh_full_screen = createMesh(gl, program_post.prg, [
         // x    y     z     u    v
          -1.0,-1.0, +1.0,  0.0, 0.0,
          +3.0,-1.0, +1.0,  2.0, 0.0,
          -1.0,+3.0, +1.0,  0.0, 2.0,
        ], [
            0,1,2
        ]);

        ////////////////////////////
        // 各種行列の事前計算
        let mat = new matIV();// 行列のシステムのオブジェクト

        // シーンの射影行列の生成
        let pMatrix   = mat.identity(mat.create());
        mat.perspective(60, canvas.width / canvas.height, 0.01, 100.0, pMatrix);

        // シーンの情報の設定
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.BLEND);// 半透明ブレンディング
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        ////////////////////////////
        // フレームの更新
        ////////////////////////////

        window.requestAnimationFrame(update);
        
        function update(timestamp){
            ////////////////////////////
            // 動かす
            ////////////////////////////

            // ビュー行列の生成(カメラの位置は固定で周囲を見渡す)
            let c_X = Math.cos(2.0 * Math.PI * (angle.x-Math.floor(angle.x)));
            let s_X = Math.sin(2.0 * Math.PI * (angle.x-Math.floor(angle.x)));
            let c_Y = Math.cos(2.0 * Math.PI * (angle.y-Math.floor(angle.y)));
            let s_Y = Math.sin(2.0 * Math.PI * (angle.y-Math.floor(angle.y)));
            let camera_pos = [0.0, 1.5, 0.0];
            let look_at = [c_X * c_Y, s_Y + camera_pos[1], s_X * c_Y];
            let up = [0.0, 1.0, 0.0];
            let vMatrix = mat.create();
            mat.lookAt(camera_pos, look_at, up, vMatrix);

            // ビュー行列の向きの逆行列
            let vMatrixRotInv = mat.create();
            let camera_dir = [
                look_at[0] - camera_pos[0], 
                look_at[1] - camera_pos[1], 
                look_at[2] - camera_pos[2]];
            mat.lookAt([0.0, 0.0, 0.0], camera_dir, up, vMatrixRotInv);
            mat.inverse (vMatrixRotInv, vMatrixRotInv);

            // ビュー射影行列の生成
            let pvMatrix = mat.create();
            mat.multiply (pMatrix, vMatrix, pvMatrix);
            
            // ビュー射影行列の逆行列を生成
            let pvMatrixInv = mat.create();
            mat.inverse (pvMatrix, pvMatrixInv);
            
            ////////////////////////////
            // 描画
            ////////////////////////////
            
            ////////////////////////////
            // 浮動小数点数バッファへの作成
            gl.bindFramebuffer(gl.FRAMEBUFFER, floatBuffer.f);
            gl.viewport(0.0, 0.0, canvas.width, canvas.height);

            ////////////////////////////
            // オブジェクト描画
            
            // 背景描画(背景のクリアを含む)
            if(envMap.tex){// キューブマップが読み込まれた後
                gl.depthFunc(gl.ALWAYS);// テストを常に成功させて強制的に書き込む
                gl.useProgram(program_bg.prg);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, envMap.tex);
                gl.uniform1i(program_bg.loc[0], 0); // 'sampCube'
                gl.uniformMatrix4fv(program_bg.loc[1], false, pvMatrixInv);// 'pvMatrixInv'
                gl.uniform3f(program_bg.loc[2], camera_pos[0], camera_pos[1], camera_pos[2]);// 'camera_pos'
                gl.bindVertexArray(mesh_full_screen.vao);
                gl.drawElements(gl.TRIANGLES, mesh_full_screen.count, gl.UNSIGNED_SHORT, 0);
                gl.depthFunc(gl.LEQUAL);// 通常のテストに戻す
            }

            // シーンの描画
            if(treeTex.tex){// 木の画像が読み込まれた後
                gl.useProgram(program_scene.prg);
                gl.uniformMatrix4fv(program_scene.loc[1], false, pvMatrix); // 'pvMatrix'
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, treeTex.tex);
                gl.uniform1i(program_scene.loc[2], 0);// 'samp'
                gl.uniformMatrix4fv(program_scene.loc[0], false, vMatrixRotInv);// ワールド行列
                gl.bindVertexArray(mesh_tree.vao);
                gl.drawElementsInstanced(gl.TRIANGLES, mesh_tree.count, gl.UNSIGNED_SHORT, 0, INSTANCE_COUNT);
            }
            
            ////////////////////////////
            // トーンマッピングと逆ガンマ補正
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);// 通常のフレームバッファに戻す
            gl.viewport(0.0, 0.0, canvas.width, canvas.height);
            
            gl.disable(gl.DEPTH_TEST);// テストは無効
            gl.useProgram(program_post.prg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, floatBuffer.t);
            gl.uniform1i(program_post.loc[0], 0); // 'samp'
            gl.bindVertexArray(mesh_full_screen.vao);
            gl.drawElements(gl.TRIANGLES, mesh_full_screen.count, gl.UNSIGNED_SHORT, 0);
            gl.enable(gl.DEPTH_TEST);// テストを戻す
            
            ////////////////////////////
            // 次のフレームへの処理
            ////////////////////////////
            gl.useProgram(null);
            gl.flush();
            window.requestAnimationFrame(update);
        }
        
    }, false);

    // シェーダの読み込み
    function load_shader(src, type)
    {
        let shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
            alert(gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    // プログラムオブジェクトの生成
    function create_program(vsSource, fsSource, uniform_names)
    {
        let prg = gl.createProgram();
        gl.attachShader(prg, load_shader(vsSource, gl.VERTEX_SHADER));
        gl.attachShader(prg, load_shader(fsSource, gl.FRAGMENT_SHADER));
        gl.linkProgram(prg);
        if(!gl.getProgramParameter(prg, gl.LINK_STATUS)){
            alert(gl.getProgramInfoLog(prg));
        }

        let uniLocations = [];
        uniform_names.forEach(function(value){
            uniLocations.push(gl.getUniformLocation(prg, value));
        });
        
        return {prg : prg, loc : uniLocations};
    }

    // テクスチャの読み込み
    function create_texture(src, dest)
    {
        // インスタンス用の配列
        let img;
        
        img = new loadImage();
        img.data.src = src; // ファイル名を指定
        
        // 画像のコンストラクタ
        function loadImage()
        {
            this.data = new Image();
            
            // 読み込まれた後の処理
            this.data.onload = function(){
                let tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);// キューブマップとしてバインド
                    
                let width = img.data.width;
                let height = img.data.height;
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
                
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                // テクスチャのバインドを無効化
                gl.bindTexture(gl.TEXTURE_2D, null);
                
                dest.tex = tex;
            };
        }
    }

    // キューブマップの読み込み
    function create_cube_texture(sources, dest)
    {
        // インスタンス用の配列
        let a_img = new Array();
        
        for(let i = 0; i < 6; i++){
            a_img[i] = new cubeMapImage();
            a_img[i].data.src = sources[i]; // ファイル名を指定
        }
        
        // キューブマップ用画像のコンストラクタ
        function cubeMapImage()
        {
            this.data = new HDRImage();
            
            // 読み込まれた後の処理
            this.data.onload = function(){
                this.isLoaded = true; // 読み込んだフラグ
                
                // 全ての画像を読み込んだらキューブマップを生成
                if( a_img[0].data.isLoaded &&
                    a_img[1].data.isLoaded &&
                    a_img[2].data.isLoaded &&
                    a_img[3].data.isLoaded &&
                    a_img[4].data.isLoaded &&
                    a_img[5].data.isLoaded)
                {
                    let tex = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);// キューブマップとしてバインド
                    
                    let width = a_img[0].data.width;
                    let height = a_img[0].data.height;
                    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, a_img[0].data.dataFloat);
                    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, a_img[1].data.dataFloat);
                    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, a_img[2].data.dataFloat);
                    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, a_img[3].data.dataFloat);
                    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, a_img[4].data.dataFloat);
                    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, a_img[5].data.dataFloat);
                    
                    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    
                    // テクスチャのバインドを無効化
                    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
                    
                    dest.tex = tex;
                }
            };
        }
    }

    // モデル描画
    function draw_mesh(program, wMatrix, mesh)
    {
        gl.uniformMatrix4fv(program.loc[0], false, wMatrix);// ワールド行列
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);// 16ビット整数
    }
    
    // インデックス付き三角形リストの生成
    function createMesh(gl, program, vertex_data, index_data) {
        let vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // 頂点バッファ
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex_data), gl.STATIC_DRAW);

        let posAttr = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 4*5, 4*0);

        let uvAttr = gl.getAttribLocation(program, 'uv');
        gl.enableVertexAttribArray(uvAttr);
        gl.vertexAttribPointer(uvAttr, 2, gl.FLOAT, false, 4*5, 4*3);

        // インデックスバッファ
        let indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index_data), gl.STATIC_DRAW);// 16ビット整数

        gl.bindVertexArray(null);

        return {vao : vao, count : index_data.length};
    };

    // インスタンス対応頂点メッシュ
    function createMeshInstanced(gl, program, vertex_data, index_data, instance_data) {
        let vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // 頂点バッファ
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex_data), gl.STATIC_DRAW);

        let posAttr = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 4*5, 4*0);

        let uvAttr = gl.getAttribLocation(program, 'uv');
        gl.enableVertexAttribArray(uvAttr);
        gl.vertexAttribPointer(uvAttr, 2, gl.FLOAT, false, 4*5, 4*3);
        
        // インスタンス頂点バッファ
        const vertexBufferInstance = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBufferInstance);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(instance_data), gl.STATIC_DRAW);

        let insAttr = gl.getAttribLocation(program, 'instance_data');
        gl.enableVertexAttribArray(insAttr);
        gl.vertexAttribPointer(insAttr, 4, gl.FLOAT, false, 4*4, 4*0);
        gl.vertexAttribDivisor(insAttr, 1);

        // インデックスバッファ
        let indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index_data), gl.STATIC_DRAW);// 16ビット整数

        gl.bindVertexArray(null);

        return {vao : vao, count : index_data.length};
    };

    // フレームバッファの生成(3成分float, float深度バッファ付き)
    function create_framebuffer(width, height){
        // フレームバッファ
        let frameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
        
        // 深度バッファ
        let depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
        
        // 書き出し用テクスチャ
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );// floatだとバイリニア不可
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        
        // 各種オブジェクトを解除
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        // フレームバッファとテクスチャを返す
        return {f : frameBuffer, t : texture};
    }
})();
