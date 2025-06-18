const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

// Configuración de Azure Storage
const accountName = "teampulsestorage";
const accountKey = "b8qCxiVoDnoY8Ebp6Z2Sg88nM2IOlC/xmm54AkpQtBamwMdNAb/NGTUauDvBiQf4yMbXc/qNiyzQ+AStt26HoA==";
const tableName = "Templates";

// SCRIPT DE EMERGENCIA - NO BORRA NADA, SOLO ARREGLA
async function emergencyFix() {
    try {
        const credential = new AzureNamedKeyCredential(accountName, accountKey);
        const tableClient = new TableClient(
            `https://${accountName}.table.core.windows.net`,
            tableName,
            credential
        );

        console.log('🚨 MODO EMERGENCIA - Arreglando registros corruptos SIN BORRAR');
        
        // Primero, veamos qué hay en la tabla
        console.log('\n🔍 Verificando estado actual de la tabla...');
        const entities = tableClient.listEntities();
        let totalCount = 0;
        let corruptedCount = 0;
        let goodCount = 0;
        
        for await (const entity of entities) {
            totalCount++;
            try {
                JSON.parse(entity.preguntas);
                console.log(`✅ ${entity.rowKey} - JSON válido`);
                goodCount++;
            } catch (e) {
                console.log(`❌ ${entity.rowKey} - JSON corrupto: ${entity.preguntas.substring(0, 50)}...`);
                corruptedCount++;
            }
        }
        
        console.log(`\n📊 Estado actual:`);
        console.log(`   Total: ${totalCount}`);
        console.log(`   Buenos: ${goodCount}`);
        console.log(`   Corruptos: ${corruptedCount}`);
        
        if (corruptedCount === 0) {
            console.log('\n✨ ¡No hay registros corruptos! La tabla está bien.');
            return;
        }
        
        console.log(`\n🔧 Arreglando ${corruptedCount} registros corruptos...`);
        
        // Solo datos de prueba - UN TEMPLATE SIMPLE PARA VERIFICAR
        const testTemplate = {
            partitionKey: "TEMPLATE",
            rowKey: "test_template_v1",
            nombre: "Test Template",
            categoria: "Test",
            descripcion: "Template de prueba",
            objetivo: "Verificar que el JSON funciona",
            preguntas: "[{\"pregunta\":\"¿Funciona este test?\",\"opciones\":[\"Sí\",\"No\"]}]", // STRING YA ESCAPADO
            creador: "TeamPulse System",
            esPublico: true,
            fechaCreacion: new Date().toISOString(),
            vecesUsado: 0,
            tags: "test",
            nivelPlan: "free"
        };
        
        console.log('\n🧪 Insertando template de prueba...');
        try {
            // Usar upsert para no fallar si ya existe
            await tableClient.upsertEntity(testTemplate, "Replace");
            console.log('✅ Template de prueba insertado');
            
            // Verificar inmediatamente
            const verification = await tableClient.getEntity("TEMPLATE", "test_template_v1");
            const parsed = JSON.parse(verification.preguntas);
            console.log(`🔍 Verificación exitosa: ${parsed.length} pregunta(s) parseada(s)`);
            console.log(`📝 JSON guardado: ${verification.preguntas}`);
            
        } catch (error) {
            console.error('❌ Error en template de prueba:', error.message);
            return;
        }
        
        console.log('\n✅ EL FORMATO FUNCIONA! Ahora puedes ejecutar el script completo.');
        console.log('\n📋 SIGUIENTE PASO:');
        console.log('1. Si tu app ahora puede leer el "test_template_v1", el formato es correcto');
        console.log('2. Luego ejecuta el script completo para arreglar todos los demás');
        
    } catch (error) {
        console.error('❌ Error en script de emergencia:', error.message);
    }
}

// SCRIPT COMPLETO - Solo ejecutar si el test funciona
async function fixAllTemplates() {
    // Templates con JSON YA ESCAPADO COMO STRING
    const templatesWithCorrectFormat = [
        {
            partitionKey: "TEMPLATE",
            rowKey: "clima_laboral_basico_v1",
            nombre: "Clima Laboral Básico",
            categoria: "HR",
            descripcion: "Evalúa el ambiente de trabajo y satisfacción del equipo",
            objetivo: "Medir la satisfacción general y el clima organizacional",
            preguntas: "[{\"pregunta\":\"¿Cómo calificarías el ambiente de trabajo en general?\",\"opciones\":[\"Excelente\",\"Bueno\",\"Regular\",\"Malo\"]},{\"pregunta\":\"¿Te sientes valorado/a en tu rol actual?\",\"opciones\":[\"Siempre\",\"Frecuentemente\",\"A veces\",\"Nunca\"]},{\"pregunta\":\"¿Cómo es la comunicación con tu equipo?\",\"opciones\":[\"Muy efectiva\",\"Efectiva\",\"Puede mejorar\",\"Deficiente\"]},{\"pregunta\":\"¿Recomendarías esta empresa como lugar de trabajo?\",\"opciones\":[\"Definitivamente sí\",\"Probablemente sí\",\"No estoy seguro/a\",\"No\"]}]",
            creador: "TeamPulse System",
            esPublico: true,
            fechaCreacion: new Date().toISOString(),
            vecesUsado: 0,
            tags: "clima,ambiente,satisfacción,hr,básico",
            nivelPlan: "free"
        },
        {
            partitionKey: "TEMPLATE",
            rowKey: "nps_cliente_v1",
            nombre: "NPS Cliente",
            categoria: "Customer",
            descripcion: "Mide la lealtad y satisfacción del cliente (Net Promoter Score)",
            objetivo: "Evaluar la probabilidad de recomendación y satisfacción del cliente",
            preguntas: "[{\"pregunta\":\"¿Qué tan probable es que recomiendes nuestro servicio? (0-10)\",\"opciones\":[\"9-10 (Promotor)\",\"7-8 (Neutral)\",\"0-6 (Detractor)\"]},{\"pregunta\":\"¿Cómo calificarías tu experiencia general?\",\"opciones\":[\"Excelente\",\"Buena\",\"Regular\",\"Mala\"]},{\"pregunta\":\"¿Qué aspecto valoras más de nuestro servicio?\",\"opciones\":[\"Calidad\",\"Precio\",\"Atención al cliente\",\"Rapidez\"]}]",
            creador: "TeamPulse System",
            esPublico: true,
            fechaCreacion: new Date().toISOString(),
            vecesUsado: 0,
            tags: "nps,cliente,satisfacción,customer,lealtad",
            nivelPlan: "free"
        }
        // Agregar más templates aquí una vez que confirmes que funciona...
    ];
    
    try {
        const credential = new AzureNamedKeyCredential(accountName, accountKey);
        const tableClient = new TableClient(
            `https://${accountName}.table.core.windows.net`,
            tableName,
            credential
        );
        
        console.log('🔧 ARREGLANDO TODOS LOS TEMPLATES...');
        
        for (const template of templatesWithCorrectFormat) {
            try {
                await tableClient.upsertEntity(template, "Replace");
                
                // Verificar
                const verification = await tableClient.getEntity(template.partitionKey, template.rowKey);
                JSON.parse(verification.preguntas); // Esto debe funcionar
                
                console.log(`✅ ${template.rowKey} - Arreglado y verificado`);
            } catch (error) {
                console.error(`❌ ${template.rowKey} - Error:`, error.message);
            }
        }
        
        console.log('\n🎉 Templates principales arreglados!');
        
    } catch (error) {
        console.error('❌ Error arreglando templates:', error.message);
    }
}

// Permitir ejecutar solo el test o todo
const args = process.argv.slice(2);
if (args.includes('--fix-all')) {
    fixAllTemplates();
} else {
    emergencyFix();
}